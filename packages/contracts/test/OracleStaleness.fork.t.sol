// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IPaperLedger} from "../src/interfaces/IPaperLedger.sol";
import {LedgerFixture} from "./utils/LedgerFixture.sol";

/// Issue #18: the staleness rule against the real, unmocked QIE feeds.
///
/// Nothing here assumes a feed is fresh. Each test reads the feed's own `updatedAt` and warps relative
/// to it, so it behaves the same whether the live round is 1 minute or 14 hours old.
contract OracleStalenessForkTest is LedgerFixture {
    function setUp() public override {
        super.setUp();
        _useRealFeeds();
    }

    function test_btc_30minutes() public {
        _checkBoundary(BTC, 1800);
    }

    function test_eth_30minutes() public {
        _checkBoundary(ETH, 1800);
    }

    function test_sol_30minutes() public {
        _checkBoundary(SOL, 1800);
    }

    function test_xrp_30minutes() public {
        _checkBoundary(XRP, 1800);
    }

    function test_gold_6hours() public {
        _checkBoundary(GOLD, 21_600);
    }

    /// One second past the limit skips; exactly at the limit trades at the real round's price.
    function _checkBoundary(uint8 asset, uint256 limit) internal {
        (uint80 round, int256 answer,, uint256 updatedAt,) = IAggregatorV3(FEEDS[asset]).latestRoundData();
        IPaperLedger.Order memory o = _buy(aliceBot, asset, 1000, "boundary");

        vm.warp(updatedAt + limit + 1);
        _expectSkip(o, IPaperLedger.SkipReason.STALE);
        _run(o);
        assertEq(ledger.unitsE18(aliceBot, asset), 0);

        vm.warp(updatedAt + limit);
        uint256 spend = START_CASH * 1000 / 10_000;
        vm.expectEmit(address(ledger));
        emit IPaperLedger.Trade(
            aliceBot,
            asset,
            true,
            spend,
            spend * 1e18 / uint256(answer),
            uint256(answer),
            round,
            updatedAt,
            "boundary",
            0
        );
        _run(o);

        // What the Trade event says can be rechecked by anyone with getRoundData.
        (, int256 recorded,, uint256 recordedAt,) = IAggregatorV3(FEEDS[asset]).getRoundData(round);
        assertEq(recorded, answer);
        assertEq(recordedAt, updatedAt);
    }

    /// A gold price older than the crypto limit is still fine.
    function test_goldIsStillValidPast30Minutes() public {
        (,,, uint256 updatedAt,) = IAggregatorV3(FEEDS[GOLD]).latestRoundData();
        vm.warp(updatedAt + 1801);
        _run(_buy(aliceBot, GOLD, 1000, "gold"));
        assertGt(ledger.unitsE18(aliceBot, GOLD), 0);
    }

    /// One stale asset holds and the rest of the batch trades. Ages are mocked; prices are the real ones.
    function test_staleAssetHoldsWhileOthersTrade() public {
        _freshAll();
        _setAge(XRP, 1801);
        _setAge(GOLD, 21_601);

        IPaperLedger.Order[] memory batch = new IPaperLedger.Order[](3);
        batch[0] = _buy(aliceBot, XRP, 1000, "xrp");
        batch[1] = _buy(aliceBot, BTC, 1000, "btc");
        batch[2] = _buy(aliceBot, GOLD, 1000, "gold");
        _expectSkip(batch[0], IPaperLedger.SkipReason.STALE);
        _expectSkip(batch[2], IPaperLedger.SkipReason.STALE);
        _runBatch(batch);

        assertEq(ledger.unitsE18(aliceBot, XRP), 0);
        assertGt(ledger.unitsE18(aliceBot, BTC), 0);
        assertEq(ledger.unitsE18(aliceBot, GOLD), 0);
    }
}
