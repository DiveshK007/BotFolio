// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {BotForwarder} from "../src/BotForwarder.sol";
import {BotRegistry} from "../src/BotRegistry.sol";
import {ForwarderAccess} from "../src/base/ForwarderAccess.sol";
import {IBotRegistry} from "../src/interfaces/IBotRegistry.sol";
import {IPaperLedger} from "../src/interfaces/IPaperLedger.sol";
import {Roles} from "../src/lib/Roles.sol";
import {ForkTest} from "./utils/ForkTest.sol";

/// Issue #9. PaperLedger is mocked here; #187 tests the real pair.
contract BotRegistryTest is ForkTest {
    BotForwarder internal fwd;
    BotRegistry internal reg;
    address internal ledger = makeAddr("botfolio.ledger");
    address internal admin = makeAddr("botfolio.admin");
    address internal seasonLedger = makeAddr("botfolio.seasonLedger");
    address internal alice;
    uint256 internal alicePk;
    address internal bob = makeAddr("botfolio.bob");
    bytes32 internal constant PERSONA = keccak256("persona");

    function setUp() public override {
        super.setUp();
        (alice, alicePk) = makeAddrAndKey("botfolio.alice");
        fwd = new BotForwarder();
        reg = new BotRegistry(address(fwd), admin, ledger);
        vm.prank(admin);
        reg.grantRole(Roles.SEASON_LEDGER, seasonLedger);
        vm.mockCall(ledger, abi.encodeWithSelector(IPaperLedger.initPortfolio.selector), "");
    }

    function _create(address who) internal returns (uint256) {
        vm.prank(who);
        return reg.createBot(PERSONA, 2500, 4);
    }

    // --- createBot

    function test_createBot_storesBotAndEmits() public {
        vm.expectEmit(address(reg));
        emit IBotRegistry.BotCreated(1, alice, PERSONA, 2500, 4);
        assertEq(_create(alice), 1);

        IBotRegistry.Bot memory b = reg.getBot(1);
        assertEq(b.owner, alice);
        assertEq(b.personaHash, PERSONA);
        assertEq(b.maxPerCoinBps, 2500);
        assertEq(b.maxTradesPerDay, 4);
        assertEq(b.version, 1);
        assertEq(b.createdAt, block.timestamp);
        assertTrue(b.active);
        assertFalse(b.house);
        assertEq(reg.botOf(alice), 1);
        assertEq(reg.nextBotId(), 2);
    }

    function test_createBot_initialisesPortfolio() public {
        vm.expectCall(ledger, abi.encodeCall(IPaperLedger.initPortfolio, (1)), 1);
        _create(alice);
    }

    function test_createBot_revertsIfLedgerReverts() public {
        vm.mockCallRevert(ledger, abi.encodeWithSelector(IPaperLedger.initPortfolio.selector), "no");
        vm.expectRevert();
        _create(alice);
        assertEq(reg.botOf(alice), 0);
    }

    function test_createBot_ownerIsForwardedSigner() public {
        _forward(fwd, alicePk, address(reg), abi.encodeCall(IBotRegistry.createBot, (PERSONA, 2500, 4)));
        assertEq(reg.getBot(1).owner, alice);
        assertEq(reg.botOf(relayer), 0);
    }

    function test_createBot_onePerWallet() public {
        _create(alice);
        vm.expectRevert(abi.encodeWithSelector(IBotRegistry.AlreadyHasBot.selector, alice));
        _create(alice);
        assertEq(_create(bob), 2);
    }

    function test_createBot_acceptsBothEdges() public {
        vm.prank(alice);
        reg.createBot(PERSONA, 1000, 1);
        vm.prank(bob);
        reg.createBot(PERSONA, 5000, 8);
    }

    function test_createBot_rejectsOutOfBounds() public {
        _expectBadLimits(999, 4);
        _expectBadLimits(5001, 4);
        _expectBadLimits(2500, 0);
        _expectBadLimits(2500, 9);
    }

    function _expectBadLimits(uint16 bps, uint8 trades) internal {
        vm.expectRevert(abi.encodeWithSelector(IBotRegistry.LimitsOutOfBounds.selector, bps, trades));
        vm.prank(alice);
        reg.createBot(PERSONA, bps, trades);
    }

    // --- createHouseBot

    function test_createHouseBot_adminCanMakeSeveral() public {
        vm.startPrank(admin);
        vm.expectEmit(address(reg));
        emit IBotRegistry.BotCreated(1, admin, PERSONA, 2000, 8);
        assertEq(reg.createHouseBot(PERSONA, 2000, 8), 1);
        assertEq(reg.createHouseBot(PERSONA, 5000, 1), 2);
        vm.stopPrank();
        assertTrue(reg.getBot(1).house);
        assertTrue(reg.getBot(2).house);
        assertEq(reg.botOf(admin), 0);
    }

    function test_createHouseBot_adminOnly() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, bytes32(0)
            )
        );
        vm.prank(alice);
        reg.createHouseBot(PERSONA, 2000, 8);
    }

    function test_createHouseBot_bounded() public {
        vm.expectRevert(abi.encodeWithSelector(IBotRegistry.LimitsOutOfBounds.selector, 6000, 4));
        vm.prank(admin);
        reg.createHouseBot(PERSONA, 6000, 4);
    }

    // --- setLimits

    function test_setLimits_updatesAndBumpsVersion() public {
        _create(alice);
        vm.expectEmit(address(reg));
        emit IBotRegistry.BotLimitsChanged(1, 2, 1500, 2);
        vm.prank(seasonLedger);
        reg.setLimits(1, 1500, 2);

        IBotRegistry.Bot memory b = reg.getBot(1);
        assertEq(b.maxPerCoinBps, 1500);
        assertEq(b.maxTradesPerDay, 2);
        assertEq(b.version, 2);
    }

    function test_setLimits_seasonLedgerOnly() public {
        _create(alice);
        address[3] memory callers = [alice, admin, relayer];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    IAccessControl.AccessControlUnauthorizedAccount.selector, callers[i], Roles.SEASON_LEDGER
                )
            );
            vm.prank(callers[i]);
            reg.setLimits(1, 1500, 2);
        }
    }

    /// createBot and setLimits must accept and reject exactly the same values.
    function testFuzz_setLimitsHasTheSameBoundsAsCreateBot(uint16 bps, uint8 trades) public {
        _create(bob);
        bool ok = bps >= 1000 && bps <= 5000 && trades >= 1 && trades <= 8;
        bytes memory err = abi.encodeWithSelector(IBotRegistry.LimitsOutOfBounds.selector, bps, trades);

        if (!ok) vm.expectRevert(err);
        vm.prank(alice);
        reg.createBot(PERSONA, bps, trades);

        if (!ok) vm.expectRevert(err);
        vm.prank(seasonLedger);
        reg.setLimits(1, bps, trades);
    }

    function test_setLimits_unknownBot() public {
        vm.expectRevert(abi.encodeWithSelector(IBotRegistry.UnknownBot.selector, 7));
        vm.prank(seasonLedger);
        reg.setLimits(7, 2500, 4);
    }

    // --- setActive

    function test_setActive_ownerPausesAndResumes() public {
        _create(alice);
        vm.expectEmit(address(reg));
        emit IBotRegistry.BotActiveChanged(1, false);
        vm.prank(alice);
        reg.setActive(1, false);
        assertFalse(reg.getBot(1).active);
        assertFalse(reg.banned(1));

        vm.prank(alice);
        reg.setActive(1, true);
        assertTrue(reg.getBot(1).active);
    }

    function test_setActive_ownerCannotUndoBan() public {
        _create(alice);
        vm.prank(admin);
        reg.setActive(1, false);
        assertTrue(reg.banned(1));

        vm.expectRevert(abi.encodeWithSelector(IBotRegistry.BotBanned.selector, 1));
        vm.prank(alice);
        reg.setActive(1, true);

        vm.prank(admin);
        reg.setActive(1, true);
        assertFalse(reg.banned(1));
        assertTrue(reg.getBot(1).active);
    }

    function test_setActive_ownerPauseWhileBannedKeepsBan() public {
        _create(alice);
        vm.prank(admin);
        reg.setActive(1, false);
        vm.prank(alice);
        reg.setActive(1, false);
        assertTrue(reg.banned(1));
    }

    function test_setActive_othersRejected() public {
        _create(alice);
        vm.expectRevert(abi.encodeWithSelector(IBotRegistry.NotOwnerOrAdmin.selector, 1, bob));
        vm.prank(bob);
        reg.setActive(1, false);
    }

    function test_setActive_unknownBot() public {
        vm.expectRevert(abi.encodeWithSelector(IBotRegistry.UnknownBot.selector, 9));
        vm.prank(admin);
        reg.setActive(9, false);
    }

    // --- deploy

    function test_constructor_rejectsZeroLedger() public {
        vm.expectRevert(ForwarderAccess.ZeroAddress.selector);
        new BotRegistry(address(fwd), admin, address(0));
    }
}
