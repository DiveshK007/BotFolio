// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC5267} from "@openzeppelin/contracts/interfaces/IERC5267.sol";

/// @title IPaperLedger
/// @notice Play-money balances and the on-chain trade log (SPEC §4.3, §5). Every trade is priced by
///         reading QIE's official mainnet oracle inside the contract; no price is ever passed in.
///         Long or cash only. No real tokens are held.
/// @dev Money: play USDT with 8 decimals (`...E8`), same scale as the feeds. Holdings: asset units
///      with 18 decimals (`...E18`). Assets: 0 BTC, 1 ETH, 2 SOL, 3 XRP, 4 GOLD.
///      IST day = (block.timestamp + 19800) / 86400.
///      Replay key per order: `orderId = keccak256(abi.encode(decisionId, actionIndex))` (SPEC §3),
///      shared by `executeBatch` and `executeApproved`.
///      Roles: DEFAULT_ADMIN_ROLE (cold key), RUNNER_ROLE (runner hot wallet; also signs
///      ApprovedOrders), REGISTRY_ROLE (held by the BotRegistry contract).
interface IPaperLedger is IAccessControl, IERC165, IERC5267 {
    /// @notice Why an order in `executeBatch` was skipped (the `reason` in `OrderSkipped`).
    /// @dev STALE: price older than maxAge, non-positive, or feed unreadable. LIMIT: trades-per-day
    ///      or per-coin cap hit, or bps > 10000. INACTIVE: bot paused/banned/unknown, or asset > 4.
    ///      ZERO: bps == 0, nothing to sell, or the order rounds to 0. USED: orderId already executed.
    enum SkipReason {
        STALE,
        LIMIT,
        INACTIVE,
        ZERO,
        USED
    }

    /// @notice A runner order inside a slot batch. `bps` = share of current cash (BUY) or of the
    ///         current holding (SELL), in basis points.
    struct Order {
        uint256 botId;
        uint8 asset;
        bool buy;
        uint16 bps;
        bytes32 decisionId;
        uint8 actionIndex;
    }

    /// @notice A big move the runner proposed and signed (EIP-712, domain "BotFolio PaperLedger",
    ///         version "1", chain 1990); the bot owner submits it via the forwarder to approve it.
    /// @dev EIP-712 type:
    ///      `ApprovedOrder(uint256 botId,uint8 asset,bool buy,uint16 bps,bytes32 decisionId,uint8 actionIndex,uint64 deadline)`
    struct ApprovedOrder {
        uint256 botId;
        uint8 asset;
        bool buy;
        uint16 bps;
        bytes32 decisionId;
        uint8 actionIndex;
        uint64 deadline;
    }

    /// @notice A trade executed at the oracle price read in this tx.
    event Trade(
        uint256 indexed botId,
        uint8 indexed asset,
        bool buy,
        uint256 cashE8,
        uint256 unitsE18,
        uint256 priceE8,
        uint80 roundId,
        uint256 updatedAt,
        bytes32 indexed decisionId,
        uint8 actionIndex
    );
    /// @notice The trade just emitted was a big move approved by the bot owner's own signed tx.
    event ApprovedTrade(
        uint256 indexed botId, bytes32 indexed decisionId, uint8 actionIndex, address indexed owner
    );
    /// @notice An order in a batch was skipped; the rest of the batch went on. `reason` is a `SkipReason`.
    event OrderSkipped(
        uint256 indexed botId,
        uint8 indexed asset,
        bytes32 indexed decisionId,
        uint8 actionIndex,
        uint8 reason
    );

    /// @notice Asset index above 4.
    error InvalidAsset(uint8 asset);
    /// @notice `initPortfolio` called twice for the same bot.
    error PortfolioExists(uint256 botId);
    /// @notice `executeApproved` caller is not the bot's owner.
    error NotBotOwner(uint256 botId, address caller);
    /// @notice `runnerSig` is malformed or not from a RUNNER_ROLE key.
    error InvalidRunnerSignature(address recovered);
    /// @notice The approved order's deadline has passed.
    error ApprovalExpired(uint64 deadline);
    /// @notice The oracle price is too old for an approved order ("price too old — try again in a few minutes").
    error PriceTooOld(uint8 asset);
    /// @notice An approved order failed a check; `reason` is a `SkipReason` (never STALE, see `PriceTooOld`).
    error OrderRejected(uint8 reason);

    /// @notice Role of the runner hot wallet.
    function RUNNER_ROLE() external view returns (bytes32);
    /// @notice Role held by the BotRegistry contract (calls `initPortfolio`).
    function REGISTRY_ROLE() external view returns (bytes32);
    /// @notice EIP-712 typehash of `ApprovedOrder`.
    function APPROVED_ORDER_TYPEHASH() external view returns (bytes32);
    /// @notice Starting play cash per bot (play USDT, 8 decimals). Fixed at deploy.
    function START_CASH_E8() external view returns (uint256);

    /// @notice The BotRegistry this ledger reads owners, limits and active flags from.
    function registry() external view returns (address);
    /// @notice The ERC-2771 forwarder this contract trusts.
    function trustedForwarder() external view returns (address);
    /// @notice True if `forwarder` is the trusted forwarder.
    /// @param forwarder Address to check.
    function isTrustedForwarder(address forwarder) external view returns (bool);

    /// @notice Oracle feed for an asset. Fixed in bytecode; there is no setter.
    /// @param asset 0 BTC, 1 ETH, 2 SOL, 3 XRP, 4 GOLD. Reverts above 4.
    function feed(uint8 asset) external view returns (address);
    /// @notice Max price age in seconds: 1800 for crypto, 21600 (6 h) for gold. No setter.
    /// @param asset 0..4. Reverts above 4.
    function maxAge(uint8 asset) external view returns (uint32);

    /// @notice Raw portfolio record. `lastDay` is the IST day `tradesToday` counts.
    /// @param botId Bot id.
    function portfolios(uint256 botId)
        external
        view
        returns (uint128 cashE8, uint16 lastDay, uint8 tradesToday, bool init);
    /// @notice Units held of one asset (18 decimals).
    /// @param botId Bot id.
    /// @param asset 0..4.
    function unitsE18(uint256 botId, uint8 asset) external view returns (uint256);
    /// @notice True once this orderId has executed (via either path).
    /// @param orderId keccak256(abi.encode(decisionId, actionIndex)).
    function usedOrder(bytes32 orderId) external view returns (bool);
    /// @notice Helper: the orderId for a decision action.
    /// @param decisionId Decision id (off-chain uuid as bytes32).
    /// @param actionIndex 0-based position in the decision's `actions` array.
    function orderIdOf(bytes32 decisionId, uint8 actionIndex) external pure returns (bytes32);
    /// @notice Helper: the EIP-712 digest the runner signs for an `ApprovedOrder`.
    /// @param o The order.
    function hashApprovedOrder(ApprovedOrder calldata o) external view returns (bytes32);

    /// @notice Cash plus every holding valued at each feed's latest answer (8 decimals).
    /// @dev Uses the latest answer even if it is older than maxAge; a feed that cannot be read counts as 0.
    ///      Leaderboard marks use the recorded `oracle_reads`, not this view (SPEC §5.6).
    /// @param botId Bot id.
    function portfolioValueE8(uint256 botId) external view returns (uint256);
    /// @notice All 5 holdings in asset order (18 decimals).
    /// @param botId Bot id.
    function holdings(uint256 botId) external view returns (uint256[5] memory units);

    /// @notice Opens a bot's portfolio with `START_CASH_E8`. REGISTRY_ROLE only (from `createBot`).
    /// @param botId Bot id.
    function initPortfolio(uint256 botId) external;

    /// @notice Executes one slot's orders. RUNNER_ROLE only. Never reverts because of one bad order:
    ///         each order either emits `Trade` or `OrderSkipped`.
    /// @param orders The slot's orders, after the off-chain risk gate.
    function executeBatch(Order[] calldata orders) external;

    /// @notice The bot owner approves a runner-signed big move; the owner's own tx is the trade.
    ///         Called via the forwarder. Unlike `executeBatch`, every failed check reverts;
    ///         a stale price reverts with `PriceTooOld`.
    /// @param o The order the runner signed.
    /// @param runnerSig EIP-712 signature over `o` by a RUNNER_ROLE key.
    function executeApproved(ApprovedOrder calldata o, bytes calldata runnerSig) external;
}
