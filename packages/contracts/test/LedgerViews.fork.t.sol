// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {LedgerFixture} from "./utils/LedgerFixture.sol";

/// Issue #12: the views against fork prices.
contract LedgerViewsForkTest is LedgerFixture {
    function _holdFour() internal returns (uint256[5] memory units, uint256 cash) {
        _run(_buy(aliceBot, BTC, 2000, "btc"));
        _run(_buy(aliceBot, ETH, 1500, "eth"));
        _run(_buy(aliceBot, XRP, 1000, "xrp"));
        _run(_buy(aliceBot, GOLD, 2500, "gold"));
        for (uint8 a; a < 5; ++a) {
            units[a] = ledger.unitsE18(aliceBot, a);
        }
        cash = _cash(aliceBot);
    }

    function test_holdingsInAssetOrder() public {
        (uint256[5] memory expected,) = _holdFour();
        uint256[5] memory got = ledger.holdings(aliceBot);
        for (uint8 a; a < 5; ++a) {
            assertEq(got[a], expected[a]);
            if (a == SOL) assertEq(got[a], 0);
            else assertGt(got[a], 0);
        }
    }

    function test_newPortfolioIsWorthStartCash() public view {
        assertEq(ledger.portfolioValueE8(aliceBot), START_CASH);
    }

    /// The real, unmocked fork prices, however old they are.
    function test_valueMatchesRealForkPrices() public {
        (uint256[5] memory units, uint256 expected) = _holdFour();
        _useRealFeeds();
        for (uint8 a; a < 5; ++a) {
            (, int256 price,,,) = IAggregatorV3(FEEDS[a]).latestRoundData();
            expected += units[a] * uint256(price) / 1e18;
        }
        assertEq(ledger.portfolioValueE8(aliceBot), expected);
        assertApproxEqAbs(expected, START_CASH, 10, "no price moved, so only rounding is lost");
    }

    function test_valueFollowsPrice() public {
        (uint256[5] memory units,) = _holdFour();
        uint256 before = ledger.portfolioValueE8(aliceBot);
        _setPrice(BTC, realPrice[BTC] * 2, block.timestamp);
        assertApproxEqAbs(
            ledger.portfolioValueE8(aliceBot), before + units[BTC] * _price(BTC) / 1e18, 1, "BTC doubled"
        );
    }

    function test_staleAnswerStillCounts() public {
        _holdFour();
        uint256 before = ledger.portfolioValueE8(aliceBot);
        _setAge(GOLD, 3 days);
        assertEq(ledger.portfolioValueE8(aliceBot), before);
    }

    function test_unreadableFeedCountsAsZero() public {
        (uint256[5] memory units,) = _holdFour();
        uint256 before = ledger.portfolioValueE8(aliceBot);
        vm.mockCallRevert(FEEDS[GOLD], abi.encodeCall(IAggregatorV3.latestRoundData, ()), "down");
        assertEq(ledger.portfolioValueE8(aliceBot), before - units[GOLD] * _price(GOLD) / 1e18);
    }

    function test_unknownBotIsWorthZero() public view {
        assertEq(ledger.portfolioValueE8(404), 0);
        uint256[5] memory got = ledger.holdings(404);
        for (uint8 a; a < 5; ++a) {
            assertEq(got[a], 0);
        }
    }
}
