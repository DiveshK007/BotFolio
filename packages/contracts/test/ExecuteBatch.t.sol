// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IPaperLedger} from "../src/interfaces/IPaperLedger.sol";
import {PaperLedger} from "../src/PaperLedger.sol";
import {Roles} from "../src/lib/Roles.sol";
import {LedgerFixture, LedgerUnderTest} from "./utils/LedgerFixture.sol";

/// Issues #10 and #19: executeBatch, limits, the per-coin cap, and a batch that never reverts.
contract ExecuteBatchTest is LedgerFixture {
    IPaperLedger.SkipReason internal constant STALE = IPaperLedger.SkipReason.STALE;
    IPaperLedger.SkipReason internal constant LIMIT = IPaperLedger.SkipReason.LIMIT;
    IPaperLedger.SkipReason internal constant INACTIVE = IPaperLedger.SkipReason.INACTIVE;
    IPaperLedger.SkipReason internal constant ZERO = IPaperLedger.SkipReason.ZERO;
    IPaperLedger.SkipReason internal constant USED = IPaperLedger.SkipReason.USED;

    // --- setup of the ledger

    function test_feedsAndMaxAgesAreTheSpecOnes() public view {
        for (uint8 a; a < 5; ++a) {
            assertEq(ledger.feed(a), FEEDS[a]);
            assertEq(ledger.maxAge(a), MAX_AGES[a]);
        }
    }

    function test_sixthAssetDoesNotExist() public {
        vm.expectRevert(abi.encodeWithSelector(IPaperLedger.InvalidAsset.selector, 5));
        ledger.feed(5);
        vm.expectRevert(abi.encodeWithSelector(IPaperLedger.InvalidAsset.selector, 5));
        ledger.maxAge(5);
    }

    function test_createBotOpensPortfolioWithStartCash() public view {
        (uint256 cash,, uint8 trades, bool init) = _portfolio(aliceBot);
        assertEq(cash, START_CASH);
        assertEq(ledger.START_CASH_E8(), START_CASH);
        assertEq(trades, 0);
        assertTrue(init);
    }

    function test_initPortfolio_registryOnly() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, runner, Roles.REGISTRY
            )
        );
        vm.prank(runner);
        ledger.initPortfolio(99);
    }

    function test_initPortfolio_onlyOnce() public {
        vm.expectRevert(abi.encodeWithSelector(IPaperLedger.PortfolioExists.selector, aliceBot));
        vm.prank(address(reg));
        ledger.initPortfolio(aliceBot);
    }

    function test_constructorRejectsBadStartCash() public {
        vm.expectRevert(abi.encodeWithSelector(PaperLedger.InvalidStartCash.selector, 0));
        new LedgerUnderTest(address(fwd), admin, address(reg), 0);
        uint256 tooBig = uint256(type(uint128).max) + 1;
        vm.expectRevert(abi.encodeWithSelector(PaperLedger.InvalidStartCash.selector, tooBig));
        new LedgerUnderTest(address(fwd), admin, address(reg), tooBig);
    }

    function test_runnerOnly() public {
        IPaperLedger.Order[] memory batch = new IPaperLedger.Order[](0);
        address[3] memory callers = [alice, admin, relayer];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    IAccessControl.AccessControlUnauthorizedAccount.selector, callers[i], Roles.RUNNER
                )
            );
            vm.prank(callers[i]);
            ledger.executeBatch(batch);
        }
    }

    // --- trades

    function test_buy_usesOraclePrice() public {
        uint256 spend = START_CASH * 2000 / 10_000;
        uint256 units = spend * 1e18 / _price(BTC);

        vm.expectEmit(address(ledger));
        emit IPaperLedger.Trade(
            aliceBot, BTC, true, spend, units, _price(BTC), realRound[BTC], block.timestamp, "buy", 0
        );
        _run(_buy(aliceBot, BTC, 2000, "buy"));

        assertEq(_cash(aliceBot), START_CASH - spend);
        assertEq(ledger.unitsE18(aliceBot, BTC), units);
        assertEq(_tradesToday(aliceBot), 1);
        assertTrue(ledger.usedOrder(keccak256(abi.encode(bytes32("buy"), uint8(0)))));
    }

    function test_sell_usesOraclePriceAtSellTime() public {
        _run(_buy(aliceBot, ETH, 3000, "buy"));
        uint256 held = ledger.unitsE18(aliceBot, ETH);
        uint256 cashBefore = _cash(aliceBot);

        int256 newPrice = realPrice[ETH] * 11 / 10;
        _setPrice(ETH, newPrice, block.timestamp);
        uint256 units = held * 4000 / 10_000;
        uint256 proceeds = units * uint256(newPrice) / 1e18;

        vm.expectEmit(address(ledger));
        emit IPaperLedger.Trade(
            aliceBot,
            ETH,
            false,
            proceeds,
            units,
            uint256(newPrice),
            realRound[ETH],
            block.timestamp,
            "sell",
            0
        );
        _run(_sell(aliceBot, ETH, 4000, "sell"));

        assertEq(ledger.unitsE18(aliceBot, ETH), held - units);
        assertEq(_cash(aliceBot), cashBefore + proceeds);
    }

    function test_sellAllLeavesNothing() public {
        _run(_buy(aliceBot, SOL, 3000, "buy"));
        _run(_sell(aliceBot, SOL, 10_000, "sell"));
        assertEq(ledger.unitsE18(aliceBot, SOL), 0);
        assertApproxEqAbs(_cash(aliceBot), START_CASH, 2, "round trip at one price, less rounding");
    }

    function test_orderIdFormula() public view {
        bytes32 id = keccak256("decision");
        assertEq(ledger.orderIdOf(id, 2), keccak256(abi.encode(id, uint8(2))));
        assertTrue(ledger.orderIdOf(id, 0) != ledger.orderIdOf(id, 1));
    }

    // --- STALE

    function test_stale_eachAssetJustOverItsMaxAge() public {
        for (uint8 a; a < 5; ++a) {
            _setAge(a, MAX_AGES[a] + 1);
            IPaperLedger.Order memory o = _buy(aliceBot, a, 100, bytes32(uint256(a)));
            _expectSkip(o, STALE);
            _run(o);
        }
        assertEq(_cash(aliceBot), START_CASH);
    }

    function test_stale_answerNotPositive() public {
        _setPrice(BTC, 0, block.timestamp);
        _expectStaleBtc("zero");
        _setPrice(BTC, -1, block.timestamp);
        _expectStaleBtc("negative");
    }

    function test_stale_badTimestamps() public {
        _setPrice(BTC, realPrice[BTC], 0);
        _expectStaleBtc("never updated");
        _setPrice(BTC, realPrice[BTC], block.timestamp + 1);
        _expectStaleBtc("future");
    }

    function test_stale_answeredInEarlierRound() public {
        _setRound(BTC, 100, realPrice[BTC], block.timestamp, 99);
        _expectStaleBtc("carried over");
    }

    function test_answeredInRoundZeroIsIgnored() public {
        _setRound(BTC, 100, realPrice[BTC], block.timestamp, 0);
        _run(_buy(aliceBot, BTC, 1000, "zero answeredIn"));
        assertGt(ledger.unitsE18(aliceBot, BTC), 0);
    }

    function test_stale_feedReverts() public {
        vm.mockCallRevert(FEEDS[BTC], abi.encodeCall(IAggregatorV3.latestRoundData, ()), "down");
        _expectStaleBtc("reverts");
    }

    function test_stale_malformedReturnData() public {
        bytes memory call_ = abi.encodeCall(IAggregatorV3.latestRoundData, ());
        vm.mockCall(FEEDS[BTC], call_, abi.encode(uint256(1), realPrice[BTC]));
        _expectStaleBtc("short");
        vm.mockCall(
            FEEDS[BTC],
            call_,
            abi.encode(type(uint256).max, realPrice[BTC], block.timestamp, block.timestamp, type(uint256).max)
        );
        _expectStaleBtc("dirty round id");
    }

    function test_stale_absurdPrice() public {
        _setPrice(BTC, int256(uint256(type(uint64).max)) + 1, block.timestamp);
        _expectStaleBtc("absurd");
        _setPrice(BTC, type(int256).max, block.timestamp);
        _expectStaleBtc("max int");
    }

    function _expectStaleBtc(bytes32 id) internal {
        IPaperLedger.Order memory o = _buy(aliceBot, BTC, 1000, id);
        _expectSkip(o, STALE);
        _run(o);
        assertEq(ledger.unitsE18(aliceBot, BTC), 0);
    }

    function test_staleSkipCanBeRetriedWithSameOrderId() public {
        IPaperLedger.Order memory o = _buy(aliceBot, XRP, 1000, "retry");
        _setAge(XRP, 1801);
        _expectSkip(o, STALE);
        _run(o);
        assertFalse(ledger.usedOrder(ledger.orderIdOf(o.decisionId, 0)));

        vm.warp(block.timestamp + 5 minutes);
        _setPrice(XRP, realPrice[XRP], block.timestamp);
        _run(o);
        assertGt(ledger.unitsE18(aliceBot, XRP), 0);
    }

    // --- LIMIT

    function test_limit_tradesPerDay() public {
        uint256 bot = _createBot(bob, 5000, 2);
        _run(_buy(bot, BTC, 500, "1"));
        _run(_buy(bot, ETH, 500, "2"));
        IPaperLedger.Order memory third = _buy(bot, SOL, 500, "3");
        _expectSkip(third, LIMIT);
        _run(third);
        assertEq(_tradesToday(bot), 2);
    }

    function test_limit_dayRollsOverAtMidnightIst() public {
        uint256 bot = _createBot(bob, 5000, 1);
        uint32 day = _day(block.timestamp);
        _warpIst(day, 0);
        _run(_buy(bot, BTC, 500, "00:00"));

        _warpIst(day, 1 days - 1);
        IPaperLedger.Order memory late = _buy(bot, BTC, 500, "23:59:59");
        _expectSkip(late, LIMIT);
        _run(late);

        _warpIst(day + 1, 0);
        _run(late);
        assertEq(_tradesToday(bot), 1);
        (, uint16 lastDay,,) = _portfolio(bot);
        assertEq(lastDay, day + 1);
    }

    function test_limit_skipsDoNotCountAsTrades() public {
        uint256 bot = _createBot(bob, 5000, 1);
        _run(_buy(bot, BTC, 0, "zero"));
        _run(_sell(bot, ETH, 100, "nothing"));
        assertEq(_tradesToday(bot), 0);
        _run(_buy(bot, BTC, 500, "real"));
        assertEq(_tradesToday(bot), 1);
    }

    function test_limit_bpsOver10000() public {
        IPaperLedger.Order memory o = _sell(aliceBot, BTC, 10_001, "too much");
        _expectSkip(o, LIMIT);
        _run(o);
    }

    function test_cap_exactlyAtCapIsAllowed() public {
        uint256 bot = _createBot(bob, 2500, 8);
        _run(_buy(bot, BTC, 2500, "at cap"));
        assertGt(ledger.unitsE18(bot, BTC), 0);
    }

    function test_cap_justOverIsSkipped() public {
        uint256 bot = _createBot(bob, 2500, 8);
        IPaperLedger.Order memory o = _buy(bot, BTC, 2501, "over cap");
        _expectSkip(o, LIMIT);
        _run(o);
    }

    function test_cap_countsWhatIsAlreadyHeld() public {
        uint256 bot = _createBot(bob, 3000, 8);
        _run(_buy(bot, GOLD, 2000, "first"));
        // 20 % held, 80 % cash: buying 13 % of cash would end at 30.4 %.
        IPaperLedger.Order memory o = _buy(bot, GOLD, 1300, "second");
        _expectSkip(o, LIMIT);
        _run(o);
        // 12 % of cash ends at 29.6 %.
        _run(_buy(bot, GOLD, 1200, "third"));
        assertEq(_tradesToday(bot), 2);
    }

    function test_cap_usesCurrentPrices() public {
        uint256 bot = _createBot(bob, 3000, 8);
        _run(_buy(bot, ETH, 2500, "eth"));
        _setPrice(ETH, realPrice[ETH] * 2, block.timestamp);
        // ETH alone is now 40 % of the portfolio.
        IPaperLedger.Order memory more = _buy(bot, ETH, 100, "more");
        _expectSkip(more, LIMIT);
        _run(more);
    }

    function test_cap_staleHeldAssetCountsAtLastAnswer() public {
        uint256 bot = _createBot(bob, 5000, 8);
        _run(_buy(bot, GOLD, 5000, "gold"));
        // Gold goes stale but is still half the portfolio. BTC for all remaining cash is then exactly
        // 50 %. Valuing stale gold at 0 would make that 100 % and wrongly skip it.
        _setAge(GOLD, 2 days);
        _run(_buy(bot, BTC, 10_000, "btc"));
        assertGt(ledger.unitsE18(bot, BTC), 0);
        assertEq(_cash(bot), 0);
    }

    function test_cap_unreadableHeldFeedCountsAsZero() public {
        uint256 bot = _createBot(bob, 5000, 8);
        _run(_buy(bot, GOLD, 5000, "gold"));
        vm.mockCallRevert(FEEDS[GOLD], abi.encodeCall(IAggregatorV3.latestRoundData, ()), "down");
        IPaperLedger.Order memory o = _buy(bot, BTC, 6000, "btc");
        _expectSkip(o, LIMIT);
        _run(o);
    }

    function test_cap_neverBlocksSell() public {
        uint256 bot = _createBot(bob, 1000, 8);
        _run(_buy(bot, BTC, 1000, "buy"));
        _setPrice(BTC, realPrice[BTC] * 5, block.timestamp);
        _run(_sell(bot, BTC, 1000, "sell"));
        assertEq(_tradesToday(bot), 2);
    }

    // --- INACTIVE

    function test_inactive_paused() public {
        vm.prank(alice);
        reg.setActive(aliceBot, false);
        _expectInactive(_buy(aliceBot, BTC, 1000, "paused"));
    }

    function test_inactive_banned() public {
        vm.prank(admin);
        reg.setActive(aliceBot, false);
        _expectInactive(_buy(aliceBot, BTC, 1000, "banned"));
    }

    function test_inactive_unknownBot() public {
        _expectInactive(_buy(404, BTC, 1000, "unknown"));
    }

    function test_inactive_assetOutOfRange() public {
        _expectInactive(_buy(aliceBot, 5, 1000, "five"));
        _expectInactive(_buy(aliceBot, 255, 1000, "255"));
    }

    function _expectInactive(IPaperLedger.Order memory o) internal {
        _expectSkip(o, INACTIVE);
        _run(o);
    }

    // --- ZERO

    function test_zero_bps() public {
        IPaperLedger.Order memory o = _buy(aliceBot, BTC, 0, "zero");
        _expectSkip(o, ZERO);
        _run(o);
    }

    function test_zero_nothingToSell() public {
        IPaperLedger.Order memory o = _sell(aliceBot, BTC, 10_000, "none");
        _expectSkip(o, ZERO);
        _run(o);
    }

    function test_zero_roundsToNothing() public {
        _run(_buy(aliceBot, BTC, 1000, "buy"));
        _setPrice(BTC, 1, block.timestamp);
        IPaperLedger.Order memory o = _sell(aliceBot, BTC, 1, "dust");
        _expectSkip(o, ZERO);
        _run(o);
    }

    function test_zero_noCashLeft() public {
        _run(_buy(aliceBot, GOLD, 5000, "half"));
        _run(_buy(aliceBot, BTC, 10_000, "rest"));
        IPaperLedger.Order memory o = _buy(aliceBot, ETH, 10_000, "broke");
        _expectSkip(o, ZERO);
        _run(o);
    }

    // --- USED

    function test_used_batchRetryIsANoOp() public {
        IPaperLedger.Order memory o = _buy(aliceBot, BTC, 1000, "once");
        _run(o);
        uint256 cash = _cash(aliceBot);
        _expectSkip(o, USED);
        _run(o);
        assertEq(_cash(aliceBot), cash);
    }

    function test_used_duplicateInsideOneBatch() public {
        IPaperLedger.Order[] memory batch = new IPaperLedger.Order[](2);
        batch[0] = _buy(aliceBot, BTC, 1000, "dup");
        batch[1] = _buy(aliceBot, BTC, 1000, "dup");
        _expectSkip(batch[1], USED);
        _runBatch(batch);
        assertEq(_tradesToday(aliceBot), 1);
    }

    function test_usedIsPerActionNotPerDecision() public {
        IPaperLedger.Order[] memory batch = new IPaperLedger.Order[](3);
        batch[0] = IPaperLedger.Order(aliceBot, BTC, true, 1000, "decision", 0);
        batch[1] = IPaperLedger.Order(aliceBot, ETH, true, 1000, "decision", 1);
        batch[2] = IPaperLedger.Order(aliceBot, SOL, true, 1000, "decision", 2);
        _runBatch(batch);
        assertEq(_tradesToday(aliceBot), 3);
    }

    // --- the batch never reverts

    /// Issue #19: five orders, two of them bad. The three good ones execute.
    function test_mixedBatchOfFiveWithTwoBad() public {
        uint256 bobBot = _createBot(bob, 2500, 4);
        _setAge(SOL, 1801);

        IPaperLedger.Order[] memory batch = new IPaperLedger.Order[](5);
        batch[0] = _buy(aliceBot, BTC, 2000, "good 1");
        batch[1] = _buy(aliceBot, SOL, 1000, "bad: stale");
        batch[2] = _buy(bobBot, ETH, 2000, "good 2");
        batch[3] = _buy(bobBot, XRP, 9000, "bad: over cap");
        batch[4] = _buy(aliceBot, GOLD, 1000, "good 3");

        _expectSkip(batch[1], STALE);
        _expectSkip(batch[3], LIMIT);
        _runBatch(batch);

        assertGt(ledger.unitsE18(aliceBot, BTC), 0);
        assertEq(ledger.unitsE18(aliceBot, SOL), 0);
        assertGt(ledger.unitsE18(bobBot, ETH), 0);
        assertEq(ledger.unitsE18(bobBot, XRP), 0);
        assertGt(ledger.unitsE18(aliceBot, GOLD), 0);
    }

    /// Any order fields against any feed answer: the call returns, and balances stay consistent.
    function testFuzz_batchNeverReverts(
        IPaperLedger.Order memory o,
        int256 answer,
        uint256 updatedAt,
        uint80 round,
        uint80 answeredIn
    ) public {
        _run(_buy(aliceBot, BTC, 3000, "seed"));
        o.botId = bound(o.botId, 0, 2);
        o.asset = uint8(bound(o.asset, 0, 6));
        if (o.asset < 5) _setRound(o.asset, round, answer, updatedAt, answeredIn);
        _run(o);
        assertLe(_tradesToday(aliceBot), 8);
    }

    /// Every price and size a valid round can carry, at the edges where overflow would happen.
    function testFuzz_validPricesNeverOverflow(uint64 buyAt, uint64 sellAt, uint16 bps) public {
        buyAt = uint64(bound(buyAt, 1, type(uint64).max));
        sellAt = uint64(bound(sellAt, 1, type(uint64).max));
        bps = uint16(bound(bps, 1, 5000));
        _setPrice(ETH, int256(uint256(buyAt)), block.timestamp);
        _run(_buy(aliceBot, ETH, bps, "buy"));
        _setPrice(ETH, int256(uint256(sellAt)), block.timestamp);
        _run(_buy(aliceBot, ETH, bps, "again"));
        _run(_sell(aliceBot, ETH, 10_000, "sell"));
    }

    function test_emptyBatch() public {
        _runBatch(new IPaperLedger.Order[](0));
        assertEq(_cash(aliceBot), START_CASH);
    }
}
