// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ForwarderAccess} from "./base/ForwarderAccess.sol";
import {IBotRegistry} from "./interfaces/IBotRegistry.sol";
import {IPaperLedger} from "./interfaces/IPaperLedger.sol";
import {IstTime} from "./lib/IstTime.sol";
import {OracleReader} from "./lib/OracleReader.sol";
import {QieFeeds} from "./lib/QieFeeds.sol";
import {Roles} from "./lib/Roles.sol";

/// @title PaperLedger
/// @notice Play balances and the trade log (SPEC §4.3, §5), settled against QIE's official mainnet
///         oracle. No price is ever an input. Long or cash only. No real funds.
/// @dev Abstract until `executeApproved` (#11) and the portfolio views (#12) land.
abstract contract PaperLedger is IPaperLedger, ForwarderAccess, EIP712 {
    struct Portfolio {
        uint128 cashE8;
        uint16 lastDay;
        uint8 tradesToday;
        bool init;
    }

    bytes32 public constant RUNNER_ROLE = Roles.RUNNER;
    bytes32 public constant REGISTRY_ROLE = Roles.REGISTRY;

    uint256 private constant BPS = 10_000;
    uint256 private constant ONE_UNIT = 1e18;

    uint256 public immutable START_CASH_E8;
    address public immutable registry;

    mapping(uint256 botId => Portfolio) public portfolios;
    mapping(uint256 botId => mapping(uint8 asset => uint256)) public unitsE18;
    mapping(bytes32 orderId => bool) public usedOrder;

    /// @notice Start cash is zero or doesn't fit `uint128`.
    error InvalidStartCash(uint256 startCashE8);

    constructor(address forwarder_, address admin, address registry_, uint256 startCashE8)
        ForwarderAccess(forwarder_, admin)
        EIP712("BotFolio PaperLedger", "1")
    {
        if (registry_ == address(0)) revert ZeroAddress();
        if (startCashE8 == 0 || startCashE8 > type(uint128).max) revert InvalidStartCash(startCashE8);
        registry = registry_;
        START_CASH_E8 = startCashE8;
    }

    function trustedForwarder() public view override(IPaperLedger, ERC2771Context) returns (address) {
        return ERC2771Context.trustedForwarder();
    }

    function isTrustedForwarder(address forwarder)
        public
        view
        override(IPaperLedger, ERC2771Context)
        returns (bool)
    {
        return ERC2771Context.isTrustedForwarder(forwarder);
    }

    function feed(uint8 asset) external pure returns (address) {
        if (asset >= QieFeeds.COUNT) revert InvalidAsset(asset);
        return QieFeeds.feedOf(asset);
    }

    function maxAge(uint8 asset) external pure returns (uint32) {
        if (asset >= QieFeeds.COUNT) revert InvalidAsset(asset);
        return QieFeeds.maxAgeOf(asset);
    }

    function orderIdOf(bytes32 decisionId, uint8 actionIndex) external pure returns (bytes32) {
        return _orderId(decisionId, actionIndex);
    }

    function initPortfolio(uint256 botId) external onlyRole(REGISTRY_ROLE) {
        Portfolio storage p = portfolios[botId];
        if (p.init) revert PortfolioExists(botId);
        p.init = true;
        p.cashE8 = uint128(START_CASH_E8);
    }

    /// @dev A failed check never reverts: `_execute` returns the reason and the loop goes on.
    function executeBatch(Order[] calldata orders) external onlyRole(RUNNER_ROLE) {
        for (uint256 i; i < orders.length; ++i) {
            Order calldata o = orders[i];
            (bool done, SkipReason reason) = _execute(o);
            if (!done) emit OrderSkipped(o.botId, o.asset, o.decisionId, o.actionIndex, uint8(reason));
        }
    }

    /// @dev The single code path for a trade. It checks in the order of SPEC §4.3 steps 0-4 and writes
    ///      state only when every check has passed, so a skipped order leaves no trace (its orderId
    ///      included, which is what lets the runner retry a stale skip).
    function _execute(Order memory o) internal returns (bool done, SkipReason reason) {
        // 0. replay guard, per order
        bytes32 orderId = _orderId(o.decisionId, o.actionIndex);
        if (usedOrder[orderId]) return (false, SkipReason.USED);

        // 1. bot and asset
        if (o.asset >= QieFeeds.COUNT) return (false, SkipReason.INACTIVE);
        Portfolio storage p = portfolios[o.botId];
        IBotRegistry.Bot memory bot = IBotRegistry(registry).getBot(o.botId);
        if (!p.init || !bot.active) return (false, SkipReason.INACTIVE);

        // 2. the price, read here and now
        OracleReader.Round memory round = OracleReader.latest(QieFeeds.feedOf(o.asset));
        if (!OracleReader.isFresh(round, QieFeeds.maxAgeOf(o.asset))) return (false, SkipReason.STALE);

        // 3. trades per IST day
        uint16 day = uint16(IstTime.dayOf(block.timestamp));
        uint8 tradesToday = p.lastDay == day ? p.tradesToday : 0;
        if (tradesToday >= bot.maxTradesPerDay) return (false, SkipReason.LIMIT);

        // 4. size and cap
        if (o.bps == 0) return (false, SkipReason.ZERO);
        if (o.bps > BPS) return (false, SkipReason.LIMIT);

        uint256 held = unitsE18[o.botId][o.asset];
        uint256 cash = p.cashE8;
        uint256 tradeCash;
        uint256 tradeUnits;
        if (o.buy) {
            tradeCash = cash * o.bps / BPS;
            tradeUnits = tradeCash * ONE_UNIT / round.price;
            if (tradeUnits == 0) return (false, SkipReason.ZERO);

            uint256 positionAfter = (held + tradeUnits) * round.price / ONE_UNIT;
            // A trade at the oracle price doesn't change the total, so the pre-trade total is the base.
            if (positionAfter * BPS > _valueE8(o.botId) * bot.maxPerCoinBps) {
                return (false, SkipReason.LIMIT);
            }
            cash -= tradeCash;
            held += tradeUnits;
        } else {
            tradeUnits = held * o.bps / BPS;
            tradeCash = tradeUnits * round.price / ONE_UNIT;
            if (tradeCash == 0) return (false, SkipReason.ZERO);

            cash += tradeCash;
            if (cash > type(uint128).max) return (false, SkipReason.LIMIT);
            held -= tradeUnits;
        }

        // 5. effects
        usedOrder[orderId] = true;
        p.cashE8 = uint128(cash);
        p.lastDay = day;
        p.tradesToday = tradesToday + 1;
        unitsE18[o.botId][o.asset] = held;

        _emitTrade(o, tradeCash, tradeUnits, round);
        return (true, reason);
    }

    /// @dev Cash plus holdings at each feed's latest answer. A stale answer still counts: SPEC §4.3
    ///      step 4 wants the last answer for the cap check. An unreadable feed counts as 0, which can
    ///      only make the cap stricter.
    function _valueE8(uint256 botId) internal view returns (uint256 total) {
        total = portfolios[botId].cashE8;
        for (uint8 asset; asset < QieFeeds.COUNT; ++asset) {
            uint256 held = unitsE18[botId][asset];
            if (held == 0) continue; // don't pay for a feed read we don't need
            total += held * OracleReader.latest(QieFeeds.feedOf(asset)).price / ONE_UNIT;
        }
    }

    /// @dev Separate only to keep `_execute` inside the EVM's stack limit.
    function _emitTrade(Order memory o, uint256 cashE8, uint256 units, OracleReader.Round memory round)
        private
    {
        emit Trade(
            o.botId,
            o.asset,
            o.buy,
            cashE8,
            units,
            round.price,
            round.roundId,
            round.updatedAt,
            o.decisionId,
            o.actionIndex
        );
    }

    /// @dev SPEC §3: one key per action, shared by both execution paths.
    function _orderId(bytes32 decisionId, uint8 actionIndex) internal pure returns (bytes32) {
        return keccak256(abi.encode(decisionId, actionIndex));
    }
}
