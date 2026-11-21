// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title ISeasonLedger
/// @notice Seasons, committed bot versions and coach corrections (SPEC §4.4).
/// @dev `commitVersion` and `recordCorrection` are user-signed via the forwarder (`_msgSender()`).
///      `openSeason`/`closeSeason` are COMMITTER_ROLE. Season numbers start at 0 (S0).
interface ISeasonLedger is IAccessControl, IERC165 {
    /// @notice State of a season number.
    enum SeasonState {
        NONE,
        OPEN,
        CLOSED
    }

    /// @notice The owner committed a new bot version (config hash), which also updated its limits.
    event VersionCommitted(uint256 indexed botId, uint32 indexed version, bytes32 hash, uint32 season);
    /// @notice The owner corrected one of the bot's calls. The note text stays off-chain (hash only).
    event CallCorrected(uint256 indexed botId, bytes32 indexed decisionId, bytes32 noteHash, uint8 chip, uint32 season);
    /// @notice A season opened.
    event SeasonOpened(uint32 indexed n, uint64 start, uint64 end);
    /// @notice A season closed and its data root (Merkle root of the replay file) was sealed.
    event SeasonClosed(uint32 indexed n, bytes32 dataRoot, string dataURI);

    /// @notice Caller may not act for this bot.
    error NotBotOwner(uint256 botId, address caller);
    /// @notice `version` is not the bot's current version + 1.
    error BadVersion(uint256 botId, uint32 expected, uint32 given);
    /// @notice The bot already has 20 corrections this IST day.
    error CorrectionCapReached(uint256 botId, uint32 day);
    /// @notice Season number is not the next one, or start/end are invalid.
    error BadSeason(uint32 n);
    /// @notice The season is not open.
    error SeasonNotOpen(uint32 n);

    /// @notice Role of the committer key (season roots).
    function COMMITTER_ROLE() external view returns (bytes32);
    /// @notice On-chain cap on corrections per bot per IST day (20).
    function MAX_CORRECTIONS_PER_DAY() external view returns (uint8);

    /// @notice The BotRegistry this ledger reads owners from and writes limits to.
    function registry() external view returns (address);
    /// @notice The ERC-2771 forwarder this contract trusts.
    function trustedForwarder() external view returns (address);
    /// @notice True if `forwarder` is the trusted forwarder.
    /// @param forwarder Address to check.
    function isTrustedForwarder(address forwarder) external view returns (bool);

    /// @notice Config hash committed for a bot version (0 if none). Version 1 is the create config,
    ///         which is committed as the persona hash in `BotRegistry`, not here.
    /// @param botId Bot id.
    /// @param version Version number.
    function configHash(uint256 botId, uint32 version) external view returns (bytes32);
    /// @notice Raw season record.
    /// @param n Season number.
    function seasons(uint32 n)
        external
        view
        returns (uint64 start, uint64 end, bytes32 dataRoot, string memory dataURI, bool closed);
    /// @notice The most recently opened season number (0 before any season opens; see `seasonState`).
    function currentSeason() external view returns (uint32);
    /// @notice The season number `openSeason` accepts next (0 before any season has opened).
    function nextSeason() external view returns (uint32);
    /// @notice NONE (never opened), OPEN or CLOSED.
    /// @param n Season number.
    function seasonState(uint32 n) external view returns (SeasonState);
    /// @notice Corrections recorded for a bot on an IST day.
    /// @param botId Bot id.
    /// @param day IST day number.
    function correctionsOnDay(uint256 botId, uint32 day) external view returns (uint8);

    /// @notice Commits the bot's next version and sets its new limits in BotRegistry (bounded there).
    ///         Bot owner via forwarder, or the admin for house bots.
    /// @param botId Bot id.
    /// @param version Must equal the bot's current version + 1.
    /// @param hash keccak256 of the version config JSON (off-chain).
    /// @param maxPerCoinBps New per-coin cap, 1000..5000 bps.
    /// @param maxTradesPerDay New trades per day, 1..8.
    function commitVersion(uint256 botId, uint32 version, bytes32 hash, uint16 maxPerCoinBps, uint8 maxTradesPerDay)
        external;

    /// @notice Records a coach correction. Bot owner only (via forwarder). Max 20 per bot per IST day.
    /// @param botId Bot id.
    /// @param decisionId The decision being corrected.
    /// @param noteHash keccak256 of the note text (text stays off-chain).
    /// @param chip Preset chip id (e.g. "too risky"), defined off-chain.
    function recordCorrection(uint256 botId, bytes32 decisionId, bytes32 noteHash, uint8 chip) external;

    /// @notice Opens season `n`. COMMITTER_ROLE only. `n` must equal `nextSeason()`; `start < end`.
    /// @param n Season number.
    /// @param start Unix start time.
    /// @param end Unix end time.
    function openSeason(uint32 n, uint64 start, uint64 end) external;

    /// @notice Closes an open season and seals its data root. COMMITTER_ROLE only.
    /// @param n Season number.
    /// @param dataRoot Merkle root (keccak256, sorted pairs) over the replay file's line hashes.
    /// @param dataURI Public URL of `season-<n>.jsonl`.
    function closeSeason(uint32 n, bytes32 dataRoot, string calldata dataURI) external;
}
