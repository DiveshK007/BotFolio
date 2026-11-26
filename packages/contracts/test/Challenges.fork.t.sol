// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Challenges} from "../src/Challenges.sol";
import {SeasonLedger} from "../src/SeasonLedger.sol";
import {ForwarderAccess} from "../src/base/ForwarderAccess.sol";
import {IChallenges} from "../src/interfaces/IChallenges.sol";
import {Roles} from "../src/lib/Roles.sol";
import {LedgerFixture} from "./utils/LedgerFixture.sol";

/// Issues #16 and #23: Challenges on a QIE mainnet fork, with the real registry and SeasonLedger.
contract ChallengesForkTest is LedgerFixture {
    SeasonLedger internal seasonsC;
    Challenges internal duels;
    address internal committer = makeAddr("botfolio.committer");
    uint256 internal bobBot;

    function setUp() public override {
        super.setUp();
        seasonsC = new SeasonLedger(address(fwd), admin, address(reg));
        duels = new Challenges(address(fwd), admin, address(reg), address(seasonsC));
        vm.startPrank(admin);
        seasonsC.grantRole(Roles.COMMITTER, committer);
        duels.grantRole(Roles.COMMITTER, committer);
        vm.stopPrank();
        bobBot = _createBot(bob, 2500, 4);
        _open(0);
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
        seasonsC.closeSeason(n, keccak256("root"), "https://example.com/s.jsonl");
    }

    function _create() internal returns (bytes32) {
        vm.prank(alice);
        return duels.create(aliceBot, 0);
    }

    function _accepted() internal returns (bytes32 code) {
        code = _create();
        vm.prank(bob);
        duels.accept(code, bobBot);
    }

    function _status(bytes32 code) internal view returns (IChallenges.Status) {
        (,,, uint8 status) = duels.challenges(code);
        return IChallenges.Status(status);
    }

    function _badStatus(bytes32 code, IChallenges.Status s) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IChallenges.BadStatus.selector, code, uint8(s));
    }

    // --- create

    function test_create_derivesCodeFromSenderAndNonce() public {
        bytes32 expected = keccak256(abi.encode(alice, uint256(0)));
        vm.expectEmit(address(duels));
        emit IChallenges.ChallengeCreated(expected, aliceBot, 0);
        assertEq(_create(), expected);

        (uint256 challenger, uint256 opponent, uint32 season,) = duels.challenges(expected);
        assertEq(challenger, aliceBot);
        assertEq(opponent, 0);
        assertEq(season, 0);
        assertEq(uint8(_status(expected)), uint8(IChallenges.Status.OPEN));
        assertEq(duels.openCount(aliceBot), 1);
        assertEq(duels.nonce(), 1);
    }

    function test_create_codesAreUnique() public {
        bytes32 first = _create();
        bytes32 second = _create();
        assertTrue(first != second);
        assertEq(second, keccak256(abi.encode(alice, uint256(1))));
    }

    function test_create_throughForwarderUsesSigner() public {
        _forward(fwd, alicePk, address(duels), abi.encodeCall(IChallenges.create, (aliceBot, 0)));
        bytes32 code = keccak256(abi.encode(alice, uint256(0)));
        assertEq(uint8(_status(code)), uint8(IChallenges.Status.OPEN));
    }

    function test_create_ownerOnly() public {
        vm.expectRevert(abi.encodeWithSelector(IChallenges.NotBotOwner.selector, aliceBot, bob));
        vm.prank(bob);
        duels.create(aliceBot, 0);
    }

    function test_create_forNextSeason() public {
        vm.prank(alice);
        bytes32 code = duels.create(aliceBot, 1);
        (,, uint32 season,) = duels.challenges(code);
        assertEq(season, 1);
    }

    function test_create_notTwoSeasonsAhead() public {
        vm.expectRevert(abi.encodeWithSelector(IChallenges.SeasonNotJoinable.selector, 2));
        vm.prank(alice);
        duels.create(aliceBot, 2);
    }

    function test_create_notForClosedSeason() public {
        _close(0);
        vm.expectRevert(abi.encodeWithSelector(IChallenges.SeasonNotJoinable.selector, 0));
        _create();
    }

    function test_create_beforeSeasonZeroOpens() public {
        SeasonLedger fresh = new SeasonLedger(address(fwd), admin, address(reg));
        Challenges c = new Challenges(address(fwd), admin, address(reg), address(fresh));
        vm.prank(alice);
        c.create(aliceBot, 0); // S0 is "next"
        vm.expectRevert(abi.encodeWithSelector(IChallenges.SeasonNotJoinable.selector, 1));
        vm.prank(alice);
        c.create(aliceBot, 1);
    }

    function test_create_eleventhOpenReverts() public {
        for (uint256 i; i < 10; ++i) {
            _create();
        }
        assertEq(duels.openCount(aliceBot), 10);
        vm.expectRevert(abi.encodeWithSelector(IChallenges.TooManyOpen.selector, aliceBot));
        _create();
    }

    function test_create_limitIsPerBot() public {
        for (uint256 i; i < 10; ++i) {
            _create();
        }
        vm.prank(bob);
        duels.create(bobBot, 0);
    }

    function test_create_acceptedStillCountsAsOpen() public {
        _accepted();
        for (uint256 i; i < 9; ++i) {
            _create();
        }
        vm.expectRevert(abi.encodeWithSelector(IChallenges.TooManyOpen.selector, aliceBot));
        _create();
    }

    // --- accept

    function test_accept() public {
        bytes32 code = _create();
        vm.expectEmit(address(duels));
        emit IChallenges.ChallengeAccepted(code, bobBot);
        vm.prank(bob);
        duels.accept(code, bobBot);

        (, uint256 opponent,,) = duels.challenges(code);
        assertEq(opponent, bobBot);
        assertEq(uint8(_status(code)), uint8(IChallenges.Status.ACCEPTED));
    }

    function test_accept_ownBotReverts() public {
        bytes32 code = _create();
        vm.expectRevert(abi.encodeWithSelector(IChallenges.SameOwner.selector, aliceBot, aliceBot));
        vm.prank(alice);
        duels.accept(code, aliceBot);
    }

    function test_accept_anotherBotOfSameOwnerReverts() public {
        vm.startPrank(admin);
        uint256 first = reg.createHouseBot("sam", 2000, 8);
        uint256 second = reg.createHouseBot("granny", 5000, 8);
        bytes32 code = duels.create(first, 0);
        vm.expectRevert(abi.encodeWithSelector(IChallenges.SameOwner.selector, first, second));
        duels.accept(code, second);
        vm.stopPrank();
    }

    function test_accept_withSomeoneElsesBotReverts() public {
        bytes32 code = _create();
        address carol = makeAddr("botfolio.carol");
        vm.expectRevert(abi.encodeWithSelector(IChallenges.NotBotOwner.selector, bobBot, carol));
        vm.prank(carol);
        duels.accept(code, bobBot);
    }

    function test_accept_twiceReverts() public {
        bytes32 code = _accepted();
        address carol = makeAddr("botfolio.carol");
        uint256 carolBot = _createBot(carol, 2500, 4);
        vm.expectRevert(_badStatus(code, IChallenges.Status.ACCEPTED));
        vm.prank(carol);
        duels.accept(code, carolBot);
    }

    function test_accept_unknownOrShortCodeReverts() public {
        bytes32 short = bytes32(bytes8(_create()));
        vm.expectRevert(_badStatus(short, IChallenges.Status.NONE));
        vm.prank(bob);
        duels.accept(short, bobBot);
    }

    function test_accept_afterSeasonClosedReverts() public {
        bytes32 code = _create();
        _close(0);
        vm.expectRevert(abi.encodeWithSelector(IChallenges.SeasonNotJoinable.selector, 0));
        vm.prank(bob);
        duels.accept(code, bobBot);
    }

    // --- settle

    function test_settle_challengerWins() public {
        _settleWinner(aliceBot);
    }

    function test_settle_opponentWins() public {
        _settleWinner(bobBot);
    }

    function _settleWinner(uint256 winner) internal {
        bytes32 code = _accepted();
        _close(0);
        vm.expectEmit(address(duels));
        emit IChallenges.ChallengeSettled(code, winner);
        vm.prank(committer);
        duels.settle(code, winner);
        assertEq(uint8(_status(code)), uint8(IChallenges.Status.SETTLED));
        assertEq(duels.openCount(aliceBot), 0);
    }

    function test_settle_committerOnly() public {
        bytes32 code = _accepted();
        _close(0);
        address[4] memory callers = [alice, bob, admin, runner];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    IAccessControl.AccessControlUnauthorizedAccount.selector, callers[i], Roles.COMMITTER
                )
            );
            vm.prank(callers[i]);
            duels.settle(code, aliceBot);
        }
    }

    function test_settle_notBeforeSeasonCloses() public {
        bytes32 code = _accepted();
        vm.expectRevert(abi.encodeWithSelector(IChallenges.SeasonNotClosed.selector, 0));
        vm.prank(committer);
        duels.settle(code, aliceBot);
    }

    function test_settle_winnerMustTakePart() public {
        bytes32 code = _accepted();
        _close(0);
        vm.expectRevert(abi.encodeWithSelector(IChallenges.NotAParticipant.selector, code, 0));
        vm.prank(committer);
        duels.settle(code, 0);
    }

    function test_settle_needsAccepted() public {
        bytes32 code = _create();
        _close(0);
        vm.expectRevert(_badStatus(code, IChallenges.Status.OPEN));
        vm.prank(committer);
        duels.settle(code, aliceBot);
    }

    function test_settle_onlyOnce() public {
        bytes32 code = _accepted();
        _close(0);
        vm.prank(committer);
        duels.settle(code, aliceBot);
        vm.expectRevert(_badStatus(code, IChallenges.Status.SETTLED));
        vm.prank(committer);
        duels.settle(code, bobBot);
    }

    // --- expire

    function test_expire_byAnyoneAfterClose() public {
        bytes32 code = _create();
        _close(0);
        vm.expectEmit(address(duels));
        emit IChallenges.ChallengeExpired(code);
        vm.prank(relayer);
        duels.expire(code);
        assertEq(uint8(_status(code)), uint8(IChallenges.Status.EXPIRED));
        assertEq(duels.openCount(aliceBot), 0);

        vm.expectRevert(_badStatus(code, IChallenges.Status.EXPIRED));
        duels.expire(code);
    }

    function test_expire_notBeforeClose() public {
        bytes32 code = _create();
        vm.expectRevert(abi.encodeWithSelector(IChallenges.SeasonNotClosed.selector, 0));
        duels.expire(code);
    }

    function test_expire_notAccepted() public {
        bytes32 code = _accepted();
        _close(0);
        vm.expectRevert(_badStatus(code, IChallenges.Status.ACCEPTED));
        duels.expire(code);
    }

    function test_expireFreesASlot() public {
        bytes32 first = _create();
        for (uint256 i; i < 9; ++i) {
            _create();
        }
        _close(0);
        _open(1);
        duels.expire(first);
        vm.prank(alice);
        duels.create(aliceBot, 1);
        assertEq(duels.openCount(aliceBot), 10);
    }

    function test_constructorRejectsZeroAddresses() public {
        vm.expectRevert(ForwarderAccess.ZeroAddress.selector);
        new Challenges(address(fwd), admin, address(0), address(seasonsC));
        vm.expectRevert(ForwarderAccess.ZeroAddress.selector);
        new Challenges(address(fwd), admin, address(reg), address(0));
    }
}
