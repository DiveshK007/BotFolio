// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SeasonLedger} from "../src/SeasonLedger.sol";
import {ForwarderAccess} from "../src/base/ForwarderAccess.sol";
import {IBotRegistry} from "../src/interfaces/IBotRegistry.sol";
import {ISeasonLedger} from "../src/interfaces/ISeasonLedger.sol";
import {Roles} from "../src/lib/Roles.sol";
import {LedgerFixture} from "./utils/LedgerFixture.sol";

/// Issue #13, against the real BotRegistry and PaperLedger.
contract SeasonLedgerTest is LedgerFixture {
    SeasonLedger internal seasonsC;
    address internal committer = makeAddr("botfolio.committer");
    bytes32 internal constant CONFIG = keccak256("config v2");
    bytes32 internal constant NOTE = keccak256("stop going all in");

    function setUp() public override {
        super.setUp();
        seasonsC = new SeasonLedger(address(fwd), admin, address(reg));
        vm.startPrank(admin);
        seasonsC.grantRole(Roles.COMMITTER, committer);
        reg.grantRole(Roles.SEASON_LEDGER, address(seasonsC));
        vm.stopPrank();
    }

    function _open(uint32 n) internal {
        vm.prank(committer);
        seasonsC.openSeason(n, uint64(block.timestamp), uint64(block.timestamp + 2 days));
    }

    /// Waits for the season's end first: closing earlier reverts (#219 item 2).
    function _close(uint32 n) internal {
        (, uint64 end,,,) = seasonsC.seasons(n);
        if (block.timestamp < end) vm.warp(end);
        vm.prank(committer);
        seasonsC.closeSeason(n, keccak256("root"), "https://example.com/season.jsonl");
    }

    // --- commitVersion

    function test_commitVersion_setsLimitsHashAndEvents() public {
        _open(0);
        vm.expectEmit(address(seasonsC));
        emit ISeasonLedger.VersionCommitted(aliceBot, 2, CONFIG, 0);
        vm.expectEmit(address(reg));
        emit IBotRegistry.BotLimitsChanged(aliceBot, 2, 2500, 3);
        vm.prank(alice);
        seasonsC.commitVersion(aliceBot, 2, CONFIG, 2500, 3);

        IBotRegistry.Bot memory b = reg.getBot(aliceBot);
        assertEq(b.version, 2);
        assertEq(b.maxPerCoinBps, 2500);
        assertEq(b.maxTradesPerDay, 3);
        assertEq(seasonsC.configHash(aliceBot, 2), CONFIG);
    }

    function test_commitVersion_mustBeCurrentPlusOne() public {
        uint32[3] memory bad = [uint32(0), 1, 3];
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(ISeasonLedger.BadVersion.selector, aliceBot, 2, bad[i]));
            vm.prank(alice);
            seasonsC.commitVersion(aliceBot, bad[i], CONFIG, 2500, 3);
        }
    }

    function test_commitVersion_sameVersionTwice() public {
        vm.prank(alice);
        seasonsC.commitVersion(aliceBot, 2, CONFIG, 2500, 3);
        vm.expectRevert(abi.encodeWithSelector(ISeasonLedger.BadVersion.selector, aliceBot, 3, 2));
        vm.prank(alice);
        seasonsC.commitVersion(aliceBot, 2, keccak256("rewrite"), 2500, 3);
        assertEq(seasonsC.configHash(aliceBot, 2), CONFIG);
    }

    function test_commitVersion_limitsAreBounded() public {
        vm.expectRevert(abi.encodeWithSelector(IBotRegistry.LimitsOutOfBounds.selector, 9000, 3));
        vm.prank(alice);
        seasonsC.commitVersion(aliceBot, 2, CONFIG, 9000, 3);
        assertEq(seasonsC.configHash(aliceBot, 2), bytes32(0));
        assertEq(reg.getBot(aliceBot).version, 1);
    }

    function test_commitVersion_ownerOnly() public {
        address[4] memory callers = [bob, admin, runner, committer];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(ISeasonLedger.NotBotOwner.selector, aliceBot, callers[i]));
            vm.prank(callers[i]);
            seasonsC.commitVersion(aliceBot, 2, CONFIG, 2500, 3);
        }
    }

    function test_commitVersion_anyAdminForHouseBot() public {
        vm.prank(admin);
        uint256 house = reg.createHouseBot("house", 2000, 8);
        address newAdmin = makeAddr("botfolio.newAdmin");
        vm.prank(admin);
        seasonsC.grantRole(bytes32(0), newAdmin);

        vm.prank(newAdmin);
        seasonsC.commitVersion(house, 2, CONFIG, 2500, 8);
        assertEq(reg.getBot(house).version, 2);

        vm.expectRevert(abi.encodeWithSelector(ISeasonLedger.NotBotOwner.selector, house, bob));
        vm.prank(bob);
        seasonsC.commitVersion(house, 3, CONFIG, 2500, 8);
    }

    function test_commitVersion_unknownBot() public {
        vm.expectRevert(abi.encodeWithSelector(ISeasonLedger.NotBotOwner.selector, 404, alice));
        vm.prank(alice);
        seasonsC.commitVersion(404, 1, CONFIG, 2500, 3);
    }

    // --- recordCorrection

    function test_correction_event() public {
        _open(0);
        _close(0);
        _open(1);
        vm.expectEmit(address(seasonsC));
        emit ISeasonLedger.CallCorrected(aliceBot, "decision", NOTE, 3, 1);
        vm.prank(alice);
        seasonsC.recordCorrection(aliceBot, "decision", NOTE, 3);
    }

    function test_correction_ownerOnly() public {
        address[3] memory callers = [bob, admin, committer];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(ISeasonLedger.NotBotOwner.selector, aliceBot, callers[i]));
            vm.prank(callers[i]);
            seasonsC.recordCorrection(aliceBot, "decision", NOTE, 1);
        }
    }

    function test_correction_twentyPerBotPerIstDay() public {
        uint32 day = _day(block.timestamp);
        vm.startPrank(alice);
        for (uint256 i; i < 20; ++i) {
            seasonsC.recordCorrection(aliceBot, bytes32(i), NOTE, 1);
        }
        vm.warp(_istTime(day, 1 days - 1));
        vm.expectRevert(abi.encodeWithSelector(ISeasonLedger.CorrectionCapReached.selector, aliceBot, day));
        seasonsC.recordCorrection(aliceBot, "21st", NOTE, 1);

        vm.warp(_istTime(day + 1, 0));
        seasonsC.recordCorrection(aliceBot, "next day", NOTE, 1);
        vm.stopPrank();
        assertEq(seasonsC.correctionsOnDay(aliceBot, day), 20);
        assertEq(seasonsC.correctionsOnDay(aliceBot, day + 1), 1);
    }

    function test_correction_capIsPerBot() public {
        uint256 bobBot = _createBot(bob, 2500, 4);
        for (uint256 i; i < 20; ++i) {
            vm.prank(alice);
            seasonsC.recordCorrection(aliceBot, bytes32(i), NOTE, 1);
        }
        vm.prank(bob);
        seasonsC.recordCorrection(bobBot, "bob", NOTE, 1);
    }

    // --- seasons

    function test_beforeAnySeason() public view {
        assertEq(seasonsC.nextSeason(), 0);
        assertEq(seasonsC.currentSeason(), 0);
        assertEq(uint8(seasonsC.seasonState(0)), uint8(ISeasonLedger.SeasonState.NONE));
    }

    function test_openSeasonZero() public {
        uint64 start = uint64(block.timestamp);
        uint64 end = start + 2 days;
        vm.expectEmit(address(seasonsC));
        emit ISeasonLedger.SeasonOpened(0, start, end);
        vm.prank(committer);
        seasonsC.openSeason(0, start, end);

        (uint64 s, uint64 e,,, bool closed) = seasonsC.seasons(0);
        assertEq(s, start);
        assertEq(e, end);
        assertFalse(closed);
        assertEq(seasonsC.nextSeason(), 1);
        assertEq(uint8(seasonsC.seasonState(0)), uint8(ISeasonLedger.SeasonState.OPEN));
    }

    function test_openSeason_inOrderAndOnce() public {
        vm.expectRevert(abi.encodeWithSelector(ISeasonLedger.BadSeason.selector, 1));
        vm.prank(committer);
        seasonsC.openSeason(1, 1, 2);

        _open(0);
        vm.expectRevert(abi.encodeWithSelector(ISeasonLedger.BadSeason.selector, 0));
        vm.prank(committer);
        seasonsC.openSeason(0, 1, 2);

        _close(0);
        _open(1);
        assertEq(seasonsC.currentSeason(), 1);
        assertEq(seasonsC.nextSeason(), 2);
    }

    function test_openSeason_startBeforeEnd() public {
        vm.expectRevert(abi.encodeWithSelector(ISeasonLedger.BadSeason.selector, 0));
        vm.prank(committer);
        seasonsC.openSeason(0, 5, 5);
    }

    function test_closeSeason() public {
        _open(0);
        vm.expectEmit(address(seasonsC));
        emit ISeasonLedger.SeasonClosed(0, keccak256("root"), "https://example.com/season.jsonl");
        _close(0);

        (,, bytes32 root, string memory uri, bool closed) = seasonsC.seasons(0);
        assertEq(root, keccak256("root"));
        assertEq(uri, "https://example.com/season.jsonl");
        assertTrue(closed);
        assertEq(uint8(seasonsC.seasonState(0)), uint8(ISeasonLedger.SeasonState.CLOSED));
    }

    function test_openSeason_needsPreviousClosed() public {
        _open(0);
        vm.expectRevert(abi.encodeWithSelector(ISeasonLedger.PreviousSeasonOpen.selector, 0));
        vm.prank(committer);
        seasonsC.openSeason(1, uint64(block.timestamp), uint64(block.timestamp + 2 days));
        assertEq(seasonsC.nextSeason(), 1);
    }

    function test_closeSeason_notBeforeEnd() public {
        _open(0);
        (, uint64 end,,,) = seasonsC.seasons(0);
        vm.warp(end - 1);
        vm.expectRevert(abi.encodeWithSelector(ISeasonLedger.SeasonNotOver.selector, 0, end));
        vm.prank(committer);
        seasonsC.closeSeason(0, keccak256("root"), "x");
        assertEq(uint8(seasonsC.seasonState(0)), uint8(ISeasonLedger.SeasonState.OPEN));

        vm.warp(end); // `end` itself is over
        vm.prank(committer);
        seasonsC.closeSeason(0, keccak256("root"), "x");
        assertEq(uint8(seasonsC.seasonState(0)), uint8(ISeasonLedger.SeasonState.CLOSED));
    }

    function test_closeSeason_onlyOnce() public {
        _open(0);
        _close(0);
        vm.expectRevert(abi.encodeWithSelector(ISeasonLedger.SeasonNotOpen.selector, 0));
        vm.prank(committer);
        seasonsC.closeSeason(0, keccak256("another root"), "x");
    }

    function test_closeSeason_neverOpened() public {
        vm.expectRevert(abi.encodeWithSelector(ISeasonLedger.SeasonNotOpen.selector, 4));
        vm.prank(committer);
        seasonsC.closeSeason(4, "root", "x");
    }

    function test_seasonsAreCommitterOnly() public {
        address[4] memory callers = [admin, runner, relayer, alice];
        for (uint256 i; i < callers.length; ++i) {
            bytes memory err = abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, callers[i], Roles.COMMITTER
            );
            vm.expectRevert(err);
            vm.prank(callers[i]);
            seasonsC.openSeason(0, 1, 2);
            vm.expectRevert(err);
            vm.prank(callers[i]);
            seasonsC.closeSeason(0, "root", "x");
        }
    }

    function test_constructorRejectsZeroRegistry() public {
        vm.expectRevert(ForwarderAccess.ZeroAddress.selector);
        new SeasonLedger(address(fwd), admin, address(0));
    }
}
