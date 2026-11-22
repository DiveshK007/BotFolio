// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {ForwarderAccess} from "./base/ForwarderAccess.sol";
import {IBotRegistry} from "./interfaces/IBotRegistry.sol";
import {ISeasonLedger} from "./interfaces/ISeasonLedger.sol";
import {IstTime} from "./lib/IstTime.sol";
import {Roles} from "./lib/Roles.sol";

/// @title SeasonLedger
/// @notice Seasons, bot versions and coach corrections (SPEC §4.4).
contract SeasonLedger is ISeasonLedger, ForwarderAccess {
    struct Season {
        uint64 start;
        uint64 end;
        bytes32 dataRoot;
        string dataURI;
        bool closed;
    }

    bytes32 public constant COMMITTER_ROLE = Roles.COMMITTER;
    uint8 public constant MAX_CORRECTIONS_PER_DAY = 20;

    address public immutable registry;

    mapping(uint256 botId => mapping(uint32 version => bytes32)) public configHash;
    mapping(uint32 n => Season) public seasons;
    mapping(uint256 botId => mapping(uint32 day => uint8)) public correctionsOnDay;

    uint32 public currentSeason;
    /// @dev How many seasons have opened, which is also the next number. Needed because the first
    ///      season is S0, so `currentSeason == 0` alone can't say whether any season has opened.
    uint32 private _opened;

    constructor(address forwarder_, address admin, address registry_) ForwarderAccess(forwarder_, admin) {
        if (registry_ == address(0)) revert ZeroAddress();
        registry = registry_;
    }

    function trustedForwarder() public view override(ISeasonLedger, ERC2771Context) returns (address) {
        return ERC2771Context.trustedForwarder();
    }

    function isTrustedForwarder(address forwarder)
        public
        view
        override(ISeasonLedger, ERC2771Context)
        returns (bool)
    {
        return ERC2771Context.isTrustedForwarder(forwarder);
    }

    function nextSeason() external view returns (uint32) {
        return _opened;
    }

    function seasonState(uint32 n) public view returns (SeasonState) {
        if (n >= _opened) return SeasonState.NONE;
        return seasons[n].closed ? SeasonState.CLOSED : SeasonState.OPEN;
    }

    /// @dev The registry applies the bounds and bumps the version, so there is one copy of each rule.
    function commitVersion(
        uint256 botId,
        uint32 version,
        bytes32 hash,
        uint16 maxPerCoinBps,
        uint8 maxTradesPerDay
    ) external {
        IBotRegistry.Bot memory bot = IBotRegistry(registry).getBot(botId);
        address caller = _msgSender();
        if (caller != bot.owner && !(bot.house && hasRole(DEFAULT_ADMIN_ROLE, caller))) {
            revert NotBotOwner(botId, caller);
        }
        uint32 expected = bot.version + 1;
        if (version != expected) revert BadVersion(botId, expected, version);

        configHash[botId][version] = hash;
        emit VersionCommitted(botId, version, hash, currentSeason);
        IBotRegistry(registry).setLimits(botId, maxPerCoinBps, maxTradesPerDay);
    }

    function recordCorrection(uint256 botId, bytes32 decisionId, bytes32 noteHash, uint8 chip) external {
        address owner = IBotRegistry(registry).getBot(botId).owner;
        address caller = _msgSender();
        if (caller != owner) revert NotBotOwner(botId, caller);

        uint32 day = uint32(IstTime.dayOf(block.timestamp));
        uint8 count = correctionsOnDay[botId][day];
        if (count >= MAX_CORRECTIONS_PER_DAY) revert CorrectionCapReached(botId, day);

        correctionsOnDay[botId][day] = count + 1;
        emit CallCorrected(botId, decisionId, noteHash, chip, currentSeason);
    }

    function openSeason(uint32 n, uint64 start, uint64 end) external onlyRole(COMMITTER_ROLE) {
        if (n != _opened || start >= end) revert BadSeason(n);

        Season storage season = seasons[n];
        season.start = start;
        season.end = end;
        currentSeason = n;
        _opened = n + 1;
        emit SeasonOpened(n, start, end);
    }

    /// @dev A root is written once. A closed season can't be closed again with another one.
    function closeSeason(uint32 n, bytes32 dataRoot, string calldata dataURI)
        external
        onlyRole(COMMITTER_ROLE)
    {
        if (seasonState(n) != SeasonState.OPEN) revert SeasonNotOpen(n);

        Season storage season = seasons[n];
        season.closed = true;
        season.dataRoot = dataRoot;
        season.dataURI = dataURI;
        emit SeasonClosed(n, dataRoot, dataURI);
    }
}
