// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ForwarderAccess} from "./base/ForwarderAccess.sol";
import {IBotRegistry} from "./interfaces/IBotRegistry.sol";
import {IDailyCall} from "./interfaces/IDailyCall.sol";
import {IstTime} from "./lib/IstTime.sol";
import {OracleReader} from "./lib/OracleReader.sol";
import {QieFeeds} from "./lib/QieFeeds.sol";
import {Roles} from "./lib/Roles.sol";

/// @title DailyCall
/// @notice Coach vs Bot on BTC, settled against QIE's official mainnet oracle (SPEC §4.7).
contract DailyCall is IDailyCall, ForwarderAccess, EIP712 {
    bytes32 public constant RUNNER_ROLE = Roles.RUNNER;
    bytes32 public constant COMMITTER_ROLE = Roles.COMMITTER;
    bytes32 public constant BOT_VIEW_TYPEHASH = keccak256("BotView(uint256 botId,uint32 day,bool botUp)");

    uint32 public constant CALL_CUTOFF = 72_000; // 20:00 IST
    uint32 public constant SETTLE_FROM = 75_600; // 21:00 IST
    uint32 public constant SETTLE_WINDOW = 1 days; // from SETTLE_FROM; a call not settled by then is void
    uint32 public constant MAX_AGE = QieFeeds.CRYPTO_MAX_AGE;

    address public immutable registry;

    mapping(uint256 botId => mapping(uint32 day => Call)) public calls;

    constructor(address forwarder_, address admin, address registry_)
        ForwarderAccess(forwarder_, admin)
        EIP712("BotFolio DailyCall", "1")
    {
        if (registry_ == address(0)) revert ZeroAddress();
        registry = registry_;
    }

    function trustedForwarder() public view override(IDailyCall, ERC2771Context) returns (address) {
        return ERC2771Context.trustedForwarder();
    }

    function isTrustedForwarder(address forwarder)
        public
        view
        override(IDailyCall, ERC2771Context)
        returns (bool)
    {
        return ERC2771Context.isTrustedForwarder(forwarder);
    }

    /// @dev The same constant PaperLedger uses, so the two can't point at different feeds.
    function btcFeed() external pure returns (address) {
        return QieFeeds.BTC_USDT;
    }

    function today() external view returns (uint32) {
        return _today();
    }

    function hashBotView(uint256 botId, uint32 day, bool botUp) external view returns (bytes32) {
        return _hashBotView(botId, day, botUp);
    }

    /// @dev Without `botSig`, the user's own tx would choose the bot's answer and rig Coach vs Bot.
    ///      The signature covers today's day number, so yesterday's can't be reused.
    function call(uint256 botId, bool userUp, bool botUp, bytes calldata botSig) external {
        address owner = IBotRegistry(registry).getBot(botId).owner;
        address caller = _msgSender();
        if (caller != owner) revert NotBotOwner(botId, caller);
        // A paused bot may still play; an admin-banned one may not (#219 item 6).
        if (IBotRegistry(registry).banned(botId)) revert BotBanned(botId);

        uint32 day = _today();
        Call storage c = calls[botId][day];
        if (c.calledAt != 0) revert AlreadyCalled(botId, day);
        // 20:00:00 itself is already closed ("before 20:00").
        if (block.timestamp >= IstTime.timeAt(day, CALL_CUTOFF)) revert CallsClosed(day);

        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(_hashBotView(botId, day, botUp), botSig);
        if (err != ECDSA.RecoverError.NoError || !hasRole(RUNNER_ROLE, signer)) {
            revert InvalidBotSignature(signer);
        }

        OracleReader.Round memory round = OracleReader.latest(QieFeeds.BTC_USDT);
        if (!OracleReader.isFresh(round, MAX_AGE)) revert PriceTooOld();

        c.userUp = userUp;
        c.botUp = botUp;
        c.priceAtCall = int256(round.price);
        c.roundAtCall = round.roundId;
        c.calledAt = uint64(block.timestamp);
        emit Called(botId, day, userUp, botUp, int256(round.price), round.roundId);
    }

    /// @dev Returns quietly when there's no usable price yet, because the worker retries (SPEC §6.1).
    ///      After the window it also returns quietly: the committer can't wait for a price it likes (#219 item 5).
    function settle(uint256[] calldata botIds, uint32 day) external onlyRole(COMMITTER_ROLE) {
        if (block.timestamp >= IstTime.timeAt(day, SETTLE_FROM) + SETTLE_WINDOW) return;
        OracleReader.Round memory round = OracleReader.latest(QieFeeds.BTC_USDT);
        if (!OracleReader.isFresh(round, MAX_AGE)) return;
        if (round.updatedAt < IstTime.timeAt(day, SETTLE_FROM)) return;

        int256 price = int256(round.price);
        for (uint256 i; i < botIds.length; ++i) {
            Call storage c = calls[botIds[i]][day];
            if (c.calledAt == 0 || c.settled) continue;

            int256 priceAtCall = c.priceAtCall;
            bool moved = price != priceAtCall; // equal price = no winner
            bool up = price > priceAtCall;
            bool userCorrect = moved && up == c.userUp;
            bool botCorrect = moved && up == c.botUp;

            c.settled = true;
            c.userCorrect = userCorrect;
            c.botCorrect = botCorrect;
            emit Settled(botIds[i], day, price, round.roundId, userCorrect, botCorrect);
        }
    }

    function _today() private view returns (uint32) {
        return uint32(IstTime.dayOf(block.timestamp));
    }

    function _hashBotView(uint256 botId, uint32 day, bool botUp) private view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(BOT_VIEW_TYPEHASH, botId, day, botUp)));
    }
}
