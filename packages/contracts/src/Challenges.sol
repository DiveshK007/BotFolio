// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {ForwarderAccess} from "./base/ForwarderAccess.sol";
import {IBotRegistry} from "./interfaces/IBotRegistry.sol";
import {IChallenges} from "./interfaces/IChallenges.sol";
import {ISeasonLedger} from "./interfaces/ISeasonLedger.sol";
import {Roles} from "./lib/Roles.sol";

/// @title Challenges
/// @notice Bot vs bot for a season. No stakes, no prizes (SPEC §4.8).
contract Challenges is IChallenges, ForwarderAccess {
    bytes32 public constant COMMITTER_ROLE = Roles.COMMITTER;
    uint8 public constant MAX_OPEN = 10;

    address public immutable registry;
    address public immutable seasonLedger;

    mapping(bytes32 code => Challenge) public challenges;
    /// @dev Counts the challenger's side only. It drops on settle or expire, not on accept.
    mapping(uint256 botId => uint8) public openCount;
    uint256 public nonce;

    constructor(address forwarder_, address admin, address registry_, address seasonLedger_)
        ForwarderAccess(forwarder_, admin)
    {
        if (registry_ == address(0) || seasonLedger_ == address(0)) revert ZeroAddress();
        registry = registry_;
        seasonLedger = seasonLedger_;
    }

    function trustedForwarder() public view override(IChallenges, ERC2771Context) returns (address) {
        return ERC2771Context.trustedForwarder();
    }

    function isTrustedForwarder(address forwarder)
        public
        view
        override(IChallenges, ERC2771Context)
        returns (bool)
    {
        return ERC2771Context.isTrustedForwarder(forwarder);
    }

    /// @dev The contract picks the code. A client-chosen one could be copied from the mempool and
    ///      registered first by someone else.
    function create(uint256 myBot, uint32 season) external returns (bytes32 code) {
        address creator = _msgSender();
        _checkOwner(myBot, creator);
        _checkJoinable(season);

        uint8 open = openCount[myBot];
        if (open >= MAX_OPEN) revert TooManyOpen(myBot);

        code = keccak256(abi.encode(creator, nonce++));
        openCount[myBot] = open + 1;
        challenges[code] =
            Challenge({challengerBot: myBot, opponentBot: 0, season: season, status: uint8(Status.OPEN)});
        emit ChallengeCreated(code, myBot, season);
    }

    function accept(bytes32 code, uint256 theirBot) external {
        Challenge storage c = challenges[code];
        _checkStatus(code, c.status, Status.OPEN);

        address accepter = _msgSender();
        _checkOwner(theirBot, accepter);

        // One bot can't have two owners, so equal owners covers both "same bot" and "my other bot".
        uint256 challenger = c.challengerBot;
        if (IBotRegistry(registry).getBot(challenger).owner == accepter) {
            revert SameOwner(challenger, theirBot);
        }
        uint32 season = c.season;
        if (ISeasonLedger(seasonLedger).seasonState(season) == ISeasonLedger.SeasonState.CLOSED) {
            revert SeasonNotJoinable(season);
        }

        c.opponentBot = theirBot;
        c.status = uint8(Status.ACCEPTED);
        emit ChallengeAccepted(code, theirBot);
    }

    function settle(bytes32 code, uint256 winnerBot) external onlyRole(COMMITTER_ROLE) {
        Challenge storage c = challenges[code];
        _checkStatus(code, c.status, Status.ACCEPTED);

        uint256 challenger = c.challengerBot;
        if (winnerBot != challenger && winnerBot != c.opponentBot) revert NotAParticipant(code, winnerBot);
        _checkClosed(c.season);

        c.status = uint8(Status.SETTLED);
        --openCount[challenger];
        emit ChallengeSettled(code, winnerBot);
    }

    /// @dev Safe for anyone to call: it only tidies up a challenge nobody can accept any more.
    function expire(bytes32 code) external {
        Challenge storage c = challenges[code];
        _checkStatus(code, c.status, Status.OPEN);
        _checkClosed(c.season);

        c.status = uint8(Status.EXPIRED);
        --openCount[c.challengerBot];
        emit ChallengeExpired(code);
    }

    function _checkOwner(uint256 botId, address caller) private view {
        if (IBotRegistry(registry).getBot(botId).owner != caller) revert NotBotOwner(botId, caller);
    }

    function _checkStatus(bytes32 code, uint8 status, Status wanted) private pure {
        if (status != uint8(wanted)) revert BadStatus(code, status);
    }

    /// @dev "Open or next" (SPEC §4.8).
    function _checkJoinable(uint32 season) private view {
        ISeasonLedger ledger = ISeasonLedger(seasonLedger);
        if (ledger.seasonState(season) == ISeasonLedger.SeasonState.OPEN) return;
        if (season != ledger.nextSeason()) revert SeasonNotJoinable(season);
    }

    function _checkClosed(uint32 season) private view {
        if (ISeasonLedger(seasonLedger).seasonState(season) != ISeasonLedger.SeasonState.CLOSED) {
            revert SeasonNotClosed(season);
        }
    }
}
