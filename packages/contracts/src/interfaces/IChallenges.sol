// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IChallenges
/// @notice Bot vs bot challenge links for one season. No stakes, no prizes (SPEC §4.8, §2.5).
/// @dev `create`/`accept` are user-signed via the forwarder, owner of the named bot only.
///      Codes are derived by the contract: keccak256(abi.encode(_msgSender(), nonce++)).
///      Roles: DEFAULT_ADMIN_ROLE, COMMITTER_ROLE (settles at season close).
interface IChallenges is IAccessControl, IERC165 {
    /// @notice Challenge status (stored as uint8).
    enum Status {
        NONE,
        OPEN,
        ACCEPTED,
        SETTLED,
        EXPIRED
    }

    /// @notice One challenge.
    struct Challenge {
        uint256 challengerBot;
        uint256 opponentBot;
        uint32 season;
        uint8 status;
    }

    /// @notice A challenge was created. The app reads the full `code` from this event.
    event ChallengeCreated(bytes32 indexed code, uint256 indexed myBot, uint32 season);
    /// @notice A friend accepted with their bot.
    event ChallengeAccepted(bytes32 indexed code, uint256 indexed theirBot);
    /// @notice Settled at season close: higher season return wins, tiebreak lower max drawdown (off-chain, recomputable).
    event ChallengeSettled(bytes32 indexed code, uint256 indexed winnerBot);
    /// @notice An unaccepted challenge expired because its season closed.
    event ChallengeExpired(bytes32 indexed code);

    /// @notice Caller does not own the bot.
    error NotBotOwner(uint256 botId, address caller);
    /// @notice Season is neither open nor the next season.
    error SeasonNotJoinable(uint32 season);
    /// @notice The bot already has 10 open challenges.
    error TooManyOpen(uint256 botId);
    /// @notice No challenge with this code, or it is in the wrong status for this call.
    error BadStatus(bytes32 code, uint8 status);
    /// @notice Same bot, or both bots have the same owner.
    error SameOwner(uint256 challengerBot, uint256 theirBot);
    /// @notice `winnerBot` is not one of the two bots.
    error NotAParticipant(bytes32 code, uint256 winnerBot);
    /// @notice The season has not closed yet.
    error SeasonNotClosed(uint32 season);

    /// @notice Role of the committer key.
    function COMMITTER_ROLE() external view returns (bytes32);
    /// @notice Max open (open or accepted, not yet settled/expired) challenges per bot (10).
    function MAX_OPEN() external view returns (uint8);

    /// @notice The BotRegistry used for owner checks.
    function registry() external view returns (address);
    /// @notice The SeasonLedger used for season state.
    function seasonLedger() external view returns (address);
    /// @notice The ERC-2771 forwarder this contract trusts.
    function trustedForwarder() external view returns (address);
    /// @notice True if `forwarder` is the trusted forwarder.
    /// @param forwarder Address to check.
    function isTrustedForwarder(address forwarder) external view returns (bool);

    /// @notice Raw challenge record.
    /// @param code Challenge code.
    function challenges(bytes32 code)
        external
        view
        returns (uint256 challengerBot, uint256 opponentBot, uint32 season, uint8 status);
    /// @notice Open (not yet settled/expired) challenges created by a bot.
    /// @param botId Bot id.
    function openCount(uint256 botId) external view returns (uint8);
    /// @notice Counter mixed into the next code.
    function nonce() external view returns (uint256);

    /// @notice Creates a challenge for `myBot` (owner only, via forwarder). `season` must be open
    ///         or the next season.
    /// @param myBot The challenger's bot.
    /// @param season Season number.
    /// @return code keccak256(abi.encode(_msgSender(), nonce)); share links use its first 8 bytes.
    function create(uint256 myBot, uint32 season) external returns (bytes32 code);

    /// @notice Accepts an open challenge with `theirBot` (owner only, via forwarder). The bots must
    ///         differ and have different owners, and the season must not be closed.
    /// @param code Full challenge code (the app resolves short links via the indexer).
    /// @param theirBot The accepting bot.
    function accept(bytes32 code, uint256 theirBot) external;

    /// @notice Records the winner of an accepted challenge after its season closed. COMMITTER_ROLE only.
    /// @param code Challenge code.
    /// @param winnerBot The challenger or the opponent bot.
    function settle(bytes32 code, uint256 winnerBot) external;

    /// @notice Expires an unaccepted challenge once its season has closed. Anyone can call it.
    /// @dev Not in SPEC §4.8's function list; needed so `openCount` drops on expiry (issue #16).
    /// @param code Challenge code.
    function expire(bytes32 code) external;
}
