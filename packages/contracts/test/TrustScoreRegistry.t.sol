// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SeasonLedger} from "../src/SeasonLedger.sol";
import {TrustScoreRegistry} from "../src/TrustScoreRegistry.sol";
import {ISeasonLedger} from "../src/interfaces/ISeasonLedger.sol";
import {ITrustScoreRegistry} from "../src/interfaces/ITrustScoreRegistry.sol";
import {Roles} from "../src/lib/Roles.sol";
import {ForkTest} from "./utils/ForkTest.sol";

/// Issue #14. The reference vector below was computed outside Solidity (`cast abi-encode` + `cast keccak`)
/// so the off-chain scorer and the replay script (#62) can test against the same numbers:
/// three bots in season 3, sorted-pair keccak256, the odd node promoted.
contract TrustScoreRegistryTest is ForkTest {
    bytes32 internal constant LEAF1 = 0x028f844c6dfc35b2e05a38c1999a513aa7a3c402baef24404f13b0040a57c664;
    bytes32 internal constant LEAF2 = 0xf5fb168b0f752662c47d9dfaf40a64f885f554e0f3abdae613be2ba0379a6bef;
    bytes32 internal constant LEAF3 = 0xcbdc486bb67594a46746fb4539742a812fb939ec676722dc7667f47e8f31cec7;
    bytes32 internal constant LEFT = 0xba716959618cf137cb25b4039ec8e7528f56b459640af8d183276eb6e23ef6ba;
    bytes32 internal constant ROOT = 0xc59ae547a0bb58564c2bef1213088509f23b9f3d74f4791aab9fca584ed6b446;

    bytes32 internal constant RULES = "trust-v1-sprint";
    bytes32 internal constant DOC = keccak256("rules doc");
    string internal constant URI = "https://example.com/trust-rules.md";

    TrustScoreRegistry internal trust;
    SeasonLedger internal seasons;
    address internal admin = makeAddr("botfolio.admin");
    address internal committer = makeAddr("botfolio.committer");

    function setUp() public override {
        super.setUp();
        // Only season state is read, so the forwarder and registry can be any address.
        seasons = new SeasonLedger(makeAddr("forwarder"), admin, makeAddr("registry"));
        trust = new TrustScoreRegistry(admin, address(seasons));
        vm.startPrank(admin);
        trust.grantRole(Roles.COMMITTER, committer);
        seasons.grantRole(Roles.COMMITTER, committer);
        vm.stopPrank();
    }

    function _publishAndCommit() internal {
        vm.prank(admin);
        trust.publishRules(RULES, URI, DOC);
        vm.prank(committer);
        trust.commitScores(3, RULES, ROOT, URI);
    }

    function _proof(bytes32 a, bytes32 b) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](2);
        p[0] = a;
        p[1] = b;
    }

    function _proof(bytes32 a) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = a;
    }

    function test_leafMatchesReferenceVector() public view {
        assertEq(trust.leafHash(3, 1, 240, 200, 125, 250, 815), LEAF1);
        assertEq(trust.leafHash(3, 2, 250, 250, 250, 250, 1000), LEAF2);
        assertEq(trust.leafHash(3, 3, 0, 17, 99, 4, 120), LEAF3);
    }

    function test_validProofs() public {
        _publishAndCommit();
        assertTrue(trust.verifyScore(3, 1, 240, 200, 125, 250, 815, _proof(LEAF2, LEAF3)));
        assertTrue(trust.verifyScore(3, 2, 250, 250, 250, 250, 1000, _proof(LEAF1, LEAF3)));
        assertTrue(trust.verifyScore(3, 3, 0, 17, 99, 4, 120, _proof(LEFT)));
    }

    function test_singleBotTree() public {
        vm.prank(admin);
        trust.publishRules(RULES, URI, DOC);
        vm.prank(committer);
        trust.commitScores(3, RULES, LEAF1, URI);
        assertTrue(trust.verifyScore(3, 1, 240, 200, 125, 250, 815, new bytes32[](0)));
    }

    function test_invalidScoresReturnFalse() public {
        _publishAndCommit();
        bytes32[] memory p = _proof(LEAF2, LEAF3);
        assertFalse(trust.verifyScore(3, 1, 241, 200, 125, 250, 816, p), "higher score");
        assertFalse(trust.verifyScore(3, 1, 240, 200, 125, 250, 1000, p), "total is not the sum");
        assertFalse(trust.verifyScore(3, 1, 200, 240, 125, 250, 815, p), "factors swapped");
        assertFalse(trust.verifyScore(3, 2, 240, 200, 125, 250, 815, p), "another bot");
        assertFalse(trust.verifyScore(4, 1, 240, 200, 125, 250, 815, p), "another season");
    }

    function test_badProofsReturnFalse() public {
        _publishAndCommit();
        assertFalse(trust.verifyScore(3, 1, 240, 200, 125, 250, 815, _proof(LEAF3, LEAF2)), "wrong order");
        assertFalse(trust.verifyScore(3, 1, 240, 200, 125, 250, 815, _proof(LEAF2)), "too short");
        assertFalse(trust.verifyScore(3, 1, 240, 200, 125, 250, 815, new bytes32[](0)), "empty");
    }

    function test_noRootIsFalse() public view {
        assertFalse(trust.verifyScore(3, 1, 240, 200, 125, 250, 815, new bytes32[](0)));
    }

    function test_hugeFactorsDoNotRevert() public {
        _publishAndCommit();
        uint16 max = type(uint16).max;
        assertFalse(trust.verifyScore(3, 1, max, max, max, max, 4, _proof(LEAF2)));
    }

    function test_publishRules() public {
        vm.expectEmit(address(trust));
        emit ITrustScoreRegistry.RulesPublished(RULES, URI, DOC);
        vm.prank(admin);
        trust.publishRules(RULES, URI, DOC);
        assertEq(trust.rulesURI(RULES), URI);
        assertEq(trust.rulesDocHash(RULES), DOC);
    }

    function test_rulesAreNeverEdited() public {
        vm.prank(admin);
        trust.publishRules(RULES, URI, DOC);
        vm.expectRevert(abi.encodeWithSelector(ITrustScoreRegistry.RulesAlreadyPublished.selector, RULES));
        vm.prank(admin);
        trust.publishRules(RULES, "https://example.com/other", keccak256("edited"));
    }

    function test_publishRules_emptyValues() public {
        vm.startPrank(admin);
        vm.expectRevert(ITrustScoreRegistry.EmptyValue.selector);
        trust.publishRules(bytes32(0), URI, DOC);
        vm.expectRevert(ITrustScoreRegistry.EmptyValue.selector);
        trust.publishRules(RULES, "", DOC);
        vm.expectRevert(ITrustScoreRegistry.EmptyValue.selector);
        trust.publishRules(RULES, URI, bytes32(0));
        vm.stopPrank();
    }

    function test_publishRules_adminOnly() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, committer, bytes32(0)
            )
        );
        vm.prank(committer);
        trust.publishRules(RULES, URI, DOC);
    }

    function test_commitScores() public {
        vm.prank(admin);
        trust.publishRules(RULES, URI, DOC);
        vm.expectEmit(address(trust));
        emit ITrustScoreRegistry.ScoresCommitted(3, RULES, ROOT, URI);
        vm.prank(committer);
        trust.commitScores(3, RULES, ROOT, URI);
        assertEq(trust.scoresRoot(3), ROOT);
        assertEq(trust.rulesVersionOf(3), RULES);
    }

    function test_dailyRootReplacesEarlierOne() public {
        _publishAndCommit();
        vm.prank(committer);
        trust.commitScores(3, RULES, LEAF1, URI);
        assertEq(trust.scoresRoot(3), LEAF1);
    }

    function test_commitScores_needsPublishedRules() public {
        vm.expectRevert(abi.encodeWithSelector(ITrustScoreRegistry.UnknownRules.selector, RULES));
        vm.prank(committer);
        trust.commitScores(3, RULES, ROOT, URI);
    }

    function test_commitScores_emptyValues() public {
        vm.startPrank(committer);
        vm.expectRevert(ITrustScoreRegistry.EmptyValue.selector);
        trust.commitScores(3, RULES, bytes32(0), URI);
        vm.expectRevert(ITrustScoreRegistry.EmptyValue.selector);
        trust.commitScores(3, RULES, ROOT, "");
        vm.stopPrank();
    }

    function test_commitScores_committerOnly() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, admin, Roles.COMMITTER
            )
        );
        vm.prank(admin);
        trust.commitScores(3, RULES, ROOT, URI);
    }

    function test_constructorRejectsZeroAddresses() public {
        vm.expectRevert(TrustScoreRegistry.ZeroAddress.selector);
        new TrustScoreRegistry(address(0), address(seasons));
        vm.expectRevert(TrustScoreRegistry.ZeroAddress.selector);
        new TrustScoreRegistry(admin, address(0));
        assertEq(trust.seasonLedger(), address(seasons));
    }

    // --- lock after close (#219 item 4)

    function _commit(uint32 season, bytes32 root) internal {
        vm.prank(committer);
        trust.commitScores(season, RULES, root, URI);
    }

    function _openAndClose(uint32 n) internal {
        vm.startPrank(committer);
        seasons.openSeason(n, uint64(block.timestamp), uint64(block.timestamp + 1));
        vm.warp(block.timestamp + 1);
        seasons.closeSeason(n, keccak256("data root"), "x");
        vm.stopPrank();
    }

    function test_commitScores_replaceableUntilClose_thenLocked() public {
        vm.prank(admin);
        trust.publishRules(RULES, URI, DOC);
        _commit(0, keccak256("day 1"));
        _commit(0, keccak256("day 2"));
        assertEq(trust.scoresRoot(0), keccak256("day 2"));

        _openAndClose(0);
        vm.expectRevert(abi.encodeWithSelector(ITrustScoreRegistry.ScoresLocked.selector, 0));
        vm.prank(committer);
        trust.commitScores(0, RULES, keccak256("rewrite"), URI);
        assertEq(trust.scoresRoot(0), keccak256("day 2"));
    }

    function test_commitScores_closedSeasonGetsItsFirstRootOnce() public {
        vm.prank(admin);
        trust.publishRules(RULES, URI, DOC);
        _openAndClose(0);
        assertEq(uint8(seasons.seasonState(0)), uint8(ISeasonLedger.SeasonState.CLOSED));

        _commit(0, keccak256("late root")); // rules published after the close: still allowed once
        vm.expectRevert(abi.encodeWithSelector(ITrustScoreRegistry.ScoresLocked.selector, 0));
        vm.prank(committer);
        trust.commitScores(0, RULES, keccak256("rewrite"), URI);
    }
}
