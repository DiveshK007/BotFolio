// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {ForwarderAccess} from "./base/ForwarderAccess.sol";
import {IBotRegistry} from "./interfaces/IBotRegistry.sol";
import {IPaperLedger} from "./interfaces/IPaperLedger.sol";
import {Roles} from "./lib/Roles.sol";

/// @title BotRegistry
/// @notice Bot ownership and risk limits (SPEC §4.2). The owner is always `_msgSender()`.
contract BotRegistry is IBotRegistry, ForwarderAccess {
    bytes32 public constant SEASON_LEDGER_ROLE = Roles.SEASON_LEDGER;
    uint16 public constant MIN_PER_COIN_BPS = 1000;
    uint16 public constant MAX_PER_COIN_BPS = 5000;
    uint8 public constant MAX_TRADES_PER_DAY = 8;

    /// @dev Immutable, so there is no "set ledger" admin power. The deploy script works out the ledger's
    ///      CREATE address before deploying it and checks that it matched.
    address public immutable paperLedger;

    mapping(uint256 botId => Bot) public bots;
    uint256 public nextBotId = 1;
    mapping(address owner => uint256 botId) public botOf;
    mapping(uint256 botId => bool) public banned;

    constructor(address forwarder_, address admin, address paperLedger_) ForwarderAccess(forwarder_, admin) {
        if (paperLedger_ == address(0)) revert ZeroAddress();
        paperLedger = paperLedger_;
    }

    function trustedForwarder() public view override(IBotRegistry, ERC2771Context) returns (address) {
        return ERC2771Context.trustedForwarder();
    }

    function isTrustedForwarder(address forwarder)
        public
        view
        override(IBotRegistry, ERC2771Context)
        returns (bool)
    {
        return ERC2771Context.isTrustedForwarder(forwarder);
    }

    function getBot(uint256 botId) external view returns (Bot memory) {
        return bots[botId];
    }

    function createBot(bytes32 personaHash, uint16 maxPerCoinBps, uint8 maxTradesPerDay)
        external
        returns (uint256 botId)
    {
        address owner = _msgSender();
        if (botOf[owner] != 0) revert AlreadyHasBot(owner);
        _checkLimits(maxPerCoinBps, maxTradesPerDay);

        botId = nextBotId++;
        botOf[owner] = botId;
        _create(botId, owner, personaHash, maxPerCoinBps, maxTradesPerDay, false);
    }

    /// @dev House bots don't use `botOf`, so one admin wallet can own all three.
    function createHouseBot(bytes32 personaHash, uint16 maxPerCoinBps, uint8 maxTradesPerDay)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (uint256 botId)
    {
        _checkLimits(maxPerCoinBps, maxTradesPerDay);

        botId = nextBotId++;
        _create(botId, _msgSender(), personaHash, maxPerCoinBps, maxTradesPerDay, true);
    }

    function setLimits(uint256 botId, uint16 maxPerCoinBps, uint8 maxTradesPerDay)
        external
        onlyRole(SEASON_LEDGER_ROLE)
    {
        Bot storage bot = bots[botId];
        if (bot.owner == address(0)) revert UnknownBot(botId);
        _checkLimits(maxPerCoinBps, maxTradesPerDay);

        bot.maxPerCoinBps = maxPerCoinBps;
        bot.maxTradesPerDay = maxTradesPerDay;
        uint32 version = ++bot.version;
        emit BotLimitsChanged(botId, version, maxPerCoinBps, maxTradesPerDay);
    }

    /// @dev An admin `false` is a ban. Without the flag the owner could undo it with `setActive(true)`.
    function setActive(uint256 botId, bool active) external {
        Bot storage bot = bots[botId];
        if (bot.owner == address(0)) revert UnknownBot(botId);

        address caller = _msgSender();
        if (hasRole(DEFAULT_ADMIN_ROLE, caller)) {
            banned[botId] = !active;
        } else if (caller != bot.owner) {
            revert NotOwnerOrAdmin(botId, caller);
        } else if (active && banned[botId]) {
            revert BotBanned(botId);
        }

        bot.active = active;
        emit BotActiveChanged(botId, active);
    }

    function _create(
        uint256 botId,
        address owner,
        bytes32 personaHash,
        uint16 maxPerCoinBps,
        uint8 maxTradesPerDay,
        bool house
    ) private {
        bots[botId] = Bot({
            owner: owner,
            personaHash: personaHash,
            maxPerCoinBps: maxPerCoinBps,
            maxTradesPerDay: maxTradesPerDay,
            version: 1,
            createdAt: uint64(block.timestamp),
            active: true,
            house: house
        });
        emit BotCreated(botId, owner, personaHash, maxPerCoinBps, maxTradesPerDay);
        IPaperLedger(paperLedger).initPortfolio(botId);
    }

    /// @dev The one bounds check that createBot, createHouseBot and setLimits all share.
    function _checkLimits(uint16 maxPerCoinBps, uint8 maxTradesPerDay) private pure {
        if (
            maxPerCoinBps < MIN_PER_COIN_BPS || maxPerCoinBps > MAX_PER_COIN_BPS || maxTradesPerDay == 0
                || maxTradesPerDay > MAX_TRADES_PER_DAY
        ) revert LimitsOutOfBounds(maxPerCoinBps, maxTradesPerDay);
    }
}
