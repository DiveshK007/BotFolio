// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {DailyCall} from "../src/DailyCall.sol";
import {ForwarderAccess} from "../src/base/ForwarderAccess.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IDailyCall} from "../src/interfaces/IDailyCall.sol";
import {Roles} from "../src/lib/Roles.sol";
import {LedgerFixture} from "./utils/LedgerFixture.sol";

/// Issues #15 and #22: DailyCall on a QIE mainnet fork.
contract DailyCallForkTest is LedgerFixture {
    bytes32 internal constant TYPEHASH = keccak256("BotView(uint256 botId,uint32 day,bool botUp)");

    DailyCall internal daily;
    address internal committer = makeAddr("botfolio.committer");
    uint32 internal day;

    function setUp() public override {
        super.setUp();
        daily = new DailyCall(address(fwd), admin, address(reg));
        vm.startPrank(admin);
        daily.grantRole(Roles.RUNNER, runner);
        daily.grantRole(Roles.COMMITTER, committer);
        vm.stopPrank();
        day = _day(block.timestamp);
    }

    function _viewSig(uint256 pk, uint256 bot, uint32 onDay, bool botUp)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(TYPEHASH, bot, onDay, botUp));
        bytes32 domain = _domain("BotFolio DailyCall", address(daily));
        return _sign(pk, MessageHashUtils.toTypedDataHash(domain, structHash));
    }

    function _call(bool userUp, bool botUp) internal {
        bytes memory sig = _viewSig(runnerPk, aliceBot, _day(block.timestamp), botUp);
        vm.prank(alice);
        daily.call(aliceBot, userUp, botUp, sig);
    }

    function _settle() internal {
        _settleFor(aliceBot, day);
    }

    function _settleFor(uint256 bot, uint32 onDay) internal {
        uint256[] memory ids = new uint256[](1);
        ids[0] = bot;
        vm.prank(committer);
        daily.settle(ids, onDay);
    }

    /// 21:00:30 IST, with a round updated at 21:00:00 exactly.
    function _priceAt21(int256 price) internal {
        uint256 at21 = _istTime(day, 21 hours);
        vm.warp(at21 + 30);
        _setRound(BTC, realRound[BTC] + 1, price, at21, realRound[BTC] + 1);
    }

    function _result() internal view returns (bool settled, bool userCorrect, bool botCorrect) {
        (,,,,, settled, userCorrect, botCorrect) = daily.calls(aliceBot, day);
    }

    function _assertNotSettled() internal view {
        (bool settled,,) = _result();
        assertFalse(settled);
    }

    // --- setup

    function test_domainAndConstants() public view {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) =
            daily.eip712Domain();
        assertEq(name, "BotFolio DailyCall");
        assertEq(version, "1");
        assertEq(chainId, 1990);
        assertEq(verifying, address(daily));
        assertEq(daily.BOT_VIEW_TYPEHASH(), TYPEHASH);
        assertEq(daily.CALL_CUTOFF(), 20 hours);
        assertEq(daily.SETTLE_FROM(), 21 hours);
        assertEq(daily.SETTLE_WINDOW(), 1 days);
        assertEq(daily.MAX_AGE(), 1800);
        assertEq(daily.btcFeed(), FEEDS[BTC]);
        assertEq(daily.btcFeed(), ledger.feed(BTC));
        assertEq(daily.today(), day);
    }

    function test_digestMatchesAnOffChainSigner() public view {
        bytes32 structHash = keccak256(abi.encode(TYPEHASH, aliceBot, day, true));
        bytes32 domain = _domain("BotFolio DailyCall", address(daily));
        assertEq(daily.hashBotView(aliceBot, day, true), MessageHashUtils.toTypedDataHash(domain, structHash));
    }

    function test_constructorRejectsZeroRegistry() public {
        vm.expectRevert(ForwarderAccess.ZeroAddress.selector);
        new DailyCall(address(fwd), admin, address(0));
    }

    // --- call

    function test_call_storesPriceAndRound() public {
        vm.expectEmit(address(daily));
        emit IDailyCall.Called(aliceBot, day, true, false, realPrice[BTC], realRound[BTC]);
        _call(true, false);

        (bool userUp, bool botUp, int256 price, uint80 round, uint64 at,,,) = daily.calls(aliceBot, day);
        assertTrue(userUp);
        assertFalse(botUp);
        assertEq(price, realPrice[BTC]);
        assertEq(round, realRound[BTC]);
        assertEq(at, block.timestamp);
    }

    function test_call_secondSameDayReverts() public {
        _call(true, false);
        bytes memory sig = _viewSig(runnerPk, aliceBot, day, false);
        vm.expectRevert(abi.encodeWithSelector(IDailyCall.AlreadyCalled.selector, aliceBot, day));
        vm.prank(alice);
        daily.call(aliceBot, false, false, sig);
    }

    function test_call_againNextDay() public {
        _call(true, false);
        _warpIst(day + 1, 0);
        _call(false, true);
        (,,,, uint64 at,,,) = daily.calls(aliceBot, day + 1);
        assertEq(at, block.timestamp);
    }

    function test_call_195959Works() public {
        _warpIst(day, 20 hours - 1);
        _call(true, true);
    }

    function test_call_200000Reverts() public {
        _expectClosed(20 hours);
    }

    function test_call_200001Reverts() public {
        _expectClosed(20 hours + 1);
    }

    function test_call_235959Reverts() public {
        _expectClosed(1 days - 1);
    }

    function _expectClosed(uint256 secondsIntoDay) internal {
        _warpIst(day, secondsIntoDay);
        bytes memory sig = _viewSig(runnerPk, aliceBot, day, true);
        vm.expectRevert(abi.encodeWithSelector(IDailyCall.CallsClosed.selector, day));
        vm.prank(alice);
        daily.call(aliceBot, true, true, sig);
    }

    function test_call_staleBtcReverts() public {
        _setAge(BTC, 1801);
        _expectTooOld();
    }

    function test_call_invalidBtcReverts() public {
        _setPrice(BTC, 0, block.timestamp);
        _expectTooOld();
        vm.mockCallRevert(FEEDS[BTC], abi.encodeCall(IAggregatorV3.latestRoundData, ()), "down");
        _expectTooOld();
    }

    function _expectTooOld() internal {
        bytes memory sig = _viewSig(runnerPk, aliceBot, day, true);
        vm.expectRevert(IDailyCall.PriceTooOld.selector);
        vm.prank(alice);
        daily.call(aliceBot, true, true, sig);
    }

    function test_call_30MinutesOldWorks() public {
        _setAge(BTC, 1800);
        _call(true, true);
    }

    function test_call_ownerOnly() public {
        bytes memory sig = _viewSig(runnerPk, aliceBot, day, true);
        address[3] memory callers = [bob, runner, relayer];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(IDailyCall.NotBotOwner.selector, aliceBot, callers[i]));
            vm.prank(callers[i]);
            daily.call(aliceBot, true, true, sig);
        }
    }

    /// #219 item 6.
    function test_call_bannedBotReverts() public {
        vm.prank(admin);
        reg.setActive(aliceBot, false);
        bytes memory sig = _viewSig(runnerPk, aliceBot, day, true);
        vm.expectRevert(abi.encodeWithSelector(IDailyCall.BotBanned.selector, aliceBot));
        vm.prank(alice);
        daily.call(aliceBot, true, true, sig);
    }

    function test_call_pausedBotWorks() public {
        vm.prank(alice);
        reg.setActive(aliceBot, false);
        _call(true, false);
        (,,,, uint64 calledAt,,,) = daily.calls(aliceBot, day);
        assertEq(calledAt, block.timestamp);
    }

    function test_call_sigFromUserReverts() public {
        bytes memory sig = _viewSig(alicePk, aliceBot, day, true);
        vm.expectRevert(abi.encodeWithSelector(IDailyCall.InvalidBotSignature.selector, alice));
        vm.prank(alice);
        daily.call(aliceBot, true, true, sig);
    }

    /// The point of botSig: the user can't choose the bot's answer.
    function test_call_userCannotFlipBotView() public {
        _expectBadSig(true, _viewSig(runnerPk, aliceBot, day, false));
    }

    function test_call_sigForAnotherDayReverts() public {
        _expectBadSig(true, _viewSig(runnerPk, aliceBot, day - 1, true));
    }

    function test_call_sigForAnotherBotReverts() public {
        _expectBadSig(true, _viewSig(runnerPk, aliceBot + 1, day, true));
    }

    function test_call_malformedSigReverts() public {
        _expectBadSig(true, "");
        _expectBadSig(true, new bytes(65));
    }

    function test_call_revokedRunnerReverts() public {
        bytes memory sig = _viewSig(runnerPk, aliceBot, day, true);
        vm.prank(admin);
        daily.revokeRole(Roles.RUNNER, runner);
        _expectBadSig(true, sig);
    }

    function _expectBadSig(bool botUp, bytes memory sig) internal {
        vm.expectPartialRevert(IDailyCall.InvalidBotSignature.selector);
        vm.prank(alice);
        daily.call(aliceBot, true, botUp, sig);
    }

    // --- settle

    function test_settle_priceUp() public {
        _call(true, false);
        _priceAt21(realPrice[BTC] + 1);

        vm.expectEmit(address(daily));
        emit IDailyCall.Settled(aliceBot, day, realPrice[BTC] + 1, realRound[BTC] + 1, true, false);
        _settle();

        (bool settled, bool user, bool bot) = _result();
        assertTrue(settled);
        assertTrue(user);
        assertFalse(bot);
    }

    function test_settle_priceDown() public {
        _call(true, false);
        _priceAt21(realPrice[BTC] - 1);
        _settle();
        (, bool user, bool bot) = _result();
        assertFalse(user);
        assertTrue(bot);
    }

    function testFuzz_settle_formula(bool userUp, bool botUp, int64 move) public {
        int256 price = realPrice[BTC];
        int256 delta = bound(int256(move), -(price - 1), price);
        _call(userUp, botUp);
        _priceAt21(price + delta);
        _settle();
        (bool settled, bool user, bool bot) = _result();
        assertTrue(settled);
        assertEq(user, delta != 0 && (delta > 0) == userUp);
        assertEq(bot, delta != 0 && (delta > 0) == botUp);
    }

    function test_settle_equalPriceHasNoWinner() public {
        _call(false, false); // both "down": they would win under a plain `(price > atCall) == up`
        _priceAt21(realPrice[BTC]);
        _settle();
        (bool settled, bool user, bool bot) = _result();
        assertTrue(settled);
        assertFalse(user);
        assertFalse(bot);
    }

    function test_settle_roundFrom205959Skips() public {
        _call(true, false);
        vm.warp(_istTime(day, 21 hours + 60));
        _setPrice(BTC, realPrice[BTC] + 5, _istTime(day, 21 hours) - 1);
        _settle(); // fresh enough, but from before 21:00: skip, no revert
        _assertNotSettled();
    }

    function test_settle_before21Skips() public {
        _call(true, false);
        _warpIst(day, 20 hours + 30 minutes);
        _settle();
        _assertNotSettled();
    }

    function test_settle_staleSkips() public {
        _call(true, false);
        vm.warp(_istTime(day, 22 hours));
        _setPrice(BTC, realPrice[BTC] + 5, block.timestamp - 1801);
        _settle();
        _assertNotSettled();
    }

    function test_settle_brokenFeedSkips() public {
        _call(true, false);
        vm.warp(_istTime(day, 21 hours + 1));
        vm.mockCallRevert(FEEDS[BTC], abi.encodeCall(IAggregatorV3.latestRoundData, ()), "down");
        _settle();
        _assertNotSettled();
    }

    function test_settle_retryAfterASkipWorks() public {
        _call(true, false);
        vm.warp(_istTime(day, 21 hours));
        _setPrice(BTC, realPrice[BTC], block.timestamp - 600);
        _settle();
        _assertNotSettled();

        vm.warp(_istTime(day, 21 hours + 10 minutes));
        _setPrice(BTC, realPrice[BTC] + 5, block.timestamp);
        _settle();
        (bool settled,,) = _result();
        assertTrue(settled);
    }

    function test_settle_next0900Retry() public {
        _call(true, false);
        _warpIst(day + 1, 9 hours);
        _settle();
        (bool settled,,) = _result();
        assertTrue(settled);
    }

    function test_settle_lastSecondOfWindowWorks() public {
        _call(true, false);
        _warpIst(day + 1, 21 hours - 1);
        _settle();
        (bool settled,,) = _result();
        assertTrue(settled);
    }

    /// #219 item 5: from 21:00 the next day the call stays void, even with a fresh price.
    function test_settle_afterWindowSkipsForever() public {
        _call(true, false);
        _warpIst(day + 1, 21 hours);
        vm.recordLogs();
        _settle();
        assertEq(vm.getRecordedLogs().length, 0);
        _assertNotSettled();

        _warpIst(day + 3, 9 hours);
        _settle();
        _assertNotSettled();
    }

    function test_settle_onlyOnce() public {
        _call(true, false);
        _priceAt21(realPrice[BTC] + 1);
        _settle();
        vm.warp(block.timestamp + 10 minutes);
        _setPrice(BTC, realPrice[BTC] - 100, block.timestamp);
        _settle();
        (, bool user,) = _result();
        assertTrue(user, "a later price must not change the result");
    }

    function test_settle_skipsBotsWithoutACall() public {
        _call(true, false);
        uint256[] memory ids = new uint256[](3);
        ids[0] = 404;
        ids[1] = aliceBot;
        ids[2] = aliceBot;
        _priceAt21(realPrice[BTC] + 1);
        vm.prank(committer);
        daily.settle(ids, day);
        (bool settled,,) = _result();
        assertTrue(settled);
        (,,,,, bool ghost,,) = daily.calls(404, day);
        assertFalse(ghost);
    }

    function test_settle_committerOnly() public {
        uint256[] memory ids = new uint256[](0);
        address[3] memory callers = [runner, admin, alice];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    IAccessControl.AccessControlUnauthorizedAccount.selector, callers[i], Roles.COMMITTER
                )
            );
            vm.prank(callers[i]);
            daily.settle(ids, day);
        }
    }

    /// Settles on the real, unmocked BTC round. The day is picked so that round is at or after its 21:00,
    /// whatever time and however old the live round is.
    function test_settle_onRealFeedRound() public {
        _useRealFeeds();
        (uint80 round, int256 price,, uint256 updatedAt,) = IAggregatorV3(FEEDS[BTC]).latestRoundData();
        day = _day(updatedAt - 21 hours);

        _warpIst(day, 10 hours);
        _setPrice(BTC, price - 1, block.timestamp); // a cheaper price at call time
        _call(true, false);

        _useRealFeeds();
        vm.warp(updatedAt + 1800);
        vm.expectEmit(address(daily));
        emit IDailyCall.Settled(aliceBot, day, price, round, true, false);
        _settle();
    }
}
