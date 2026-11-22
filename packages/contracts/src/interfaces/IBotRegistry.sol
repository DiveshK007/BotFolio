// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IBotRegistry
/// @notice Who owns which bot, its persona hash and its risk limits (SPEC §4.2).
/// @dev User calls arrive through `BotForwarder`; the owner is always `_msgSender()` (ERC-2771).
///      Roles: DEFAULT_ADMIN_ROLE (cold key; "ADMIN_ROLE" in the spec), SEASON_LEDGER_ROLE (held by
///      the SeasonLedger contract, which calls `setLimits` from `commitVersion`).
interface IBotRegistry is IAccessControl, IERC165 {
    /// @notice One bot. `version` starts at 1 on create and goes up by 1 per committed version.
    struct Bot {
        address owner;
        bytes32 personaHash;
        uint16 maxPerCoinBps;
        uint8 maxTradesPerDay;
        uint32 version;
        uint64 createdAt;
        bool active;
        bool house;
    }

    /// @notice A bot was created (user bot or house bot; read `bots(botId).house` to tell them apart).
    event BotCreated(
        uint256 indexed botId,
        address indexed owner,
        bytes32 personaHash,
        uint16 maxPerCoinBps,
        uint8 maxTradesPerDay
    );
    /// @notice A new version changed the bot's limits. `version` is the bot's new version number.
    event BotLimitsChanged(
        uint256 indexed botId, uint32 version, uint16 maxPerCoinBps, uint8 maxTradesPerDay
    );
    /// @notice The bot was paused/unpaused by its owner, or banned/unbanned by the admin.
    event BotActiveChanged(uint256 indexed botId, bool active);

    /// @notice This wallet already has a bot (MVP: 1 bot per wallet).
    error AlreadyHasBot(address owner);
    /// @notice Limits outside 1000..5000 bps per coin or 1..8 trades per day.
    error LimitsOutOfBounds(uint16 maxPerCoinBps, uint8 maxTradesPerDay);
    /// @notice No bot with this id.
    error UnknownBot(uint256 botId);
    /// @notice Caller is neither the bot's owner nor the admin.
    error NotOwnerOrAdmin(uint256 botId, address caller);
    /// @notice The admin banned this bot; only the admin can turn it back on.
    error BotBanned(uint256 botId);

    /// @notice Role held by the SeasonLedger contract.
    function SEASON_LEDGER_ROLE() external view returns (bytes32);
    /// @notice Lowest allowed per-coin cap, in bps (10 %).
    function MIN_PER_COIN_BPS() external view returns (uint16);
    /// @notice Highest allowed per-coin cap, in bps (50 %).
    function MAX_PER_COIN_BPS() external view returns (uint16);
    /// @notice Highest allowed trades per IST day (8). The lowest is 1.
    function MAX_TRADES_PER_DAY() external view returns (uint8);

    /// @notice The PaperLedger this registry opens portfolios on (fixed at deploy).
    function paperLedger() external view returns (address);
    /// @notice The ERC-2771 forwarder this contract trusts.
    function trustedForwarder() external view returns (address);
    /// @notice True if `forwarder` is the trusted forwarder.
    /// @param forwarder Address to check.
    function isTrustedForwarder(address forwarder) external view returns (bool);

    /// @notice Raw bot record (auto getter of the `bots` mapping).
    /// @param botId Bot id.
    function bots(uint256 botId)
        external
        view
        returns (
            address owner,
            bytes32 personaHash,
            uint16 maxPerCoinBps,
            uint8 maxTradesPerDay,
            uint32 version,
            uint64 createdAt,
            bool active,
            bool house
        );
    /// @notice Bot record as a struct, for other contracts. Returns an empty struct for unknown ids.
    /// @param botId Bot id.
    function getBot(uint256 botId) external view returns (Bot memory);
    /// @notice The id the next bot will get. Bot ids start at 1.
    function nextBotId() external view returns (uint256);
    /// @notice The user bot owned by `owner`, or 0. House bots are not recorded here.
    /// @param owner Wallet.
    function botOf(address owner) external view returns (uint256);
    /// @notice True if the admin switched this bot off (abuse ban). The owner cannot switch it back on.
    /// @param botId Bot id.
    function banned(uint256 botId) external view returns (bool);

    /// @notice Creates the caller's bot (via forwarder, user-signed) and opens its play portfolio.
    ///         Signing this also authorises BotFolio's runner to trade the bot (stated in the UI).
    /// @param personaHash keccak256 of the persona JSON stored off-chain.
    /// @param maxPerCoinBps Max share of portfolio in one asset, 1000..5000 bps.
    /// @param maxTradesPerDay Max trades per IST day, 1..8.
    /// @return botId The new bot id.
    function createBot(bytes32 personaHash, uint16 maxPerCoinBps, uint8 maxTradesPerDay)
        external
        returns (uint256 botId);

    /// @notice Creates a house bot (Steady Sam, Gold Granny, Momentum Max). Admin only. Same bounds.
    /// @param personaHash keccak256 of the house bot's rules doc.
    /// @param maxPerCoinBps Max share per asset, 1000..5000 bps.
    /// @param maxTradesPerDay Max trades per IST day, 1..8.
    /// @return botId The new bot id.
    function createHouseBot(bytes32 personaHash, uint16 maxPerCoinBps, uint8 maxTradesPerDay)
        external
        returns (uint256 botId);

    /// @notice Sets new limits and bumps `version` by 1. SEASON_LEDGER_ROLE only (from
    ///         `SeasonLedger.commitVersion`). Same bounds check as `createBot`.
    /// @param botId Bot id.
    /// @param maxPerCoinBps New per-coin cap, 1000..5000 bps.
    /// @param maxTradesPerDay New trades per day, 1..8.
    function setLimits(uint256 botId, uint16 maxPerCoinBps, uint8 maxTradesPerDay) external;

    /// @notice Pauses/unpauses a bot. The owner (via forwarder) or the admin. When the admin sets
    ///         `false` the bot is banned: the owner can no longer turn it on; only the admin can.
    /// @param botId Bot id.
    /// @param active New state.
    function setActive(uint256 botId, bool active) external;
}
