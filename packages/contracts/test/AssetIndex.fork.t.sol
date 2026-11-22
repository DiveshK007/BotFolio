// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {QieFeeds} from "../src/lib/QieFeeds.sol";
import {DeployedFixture} from "./utils/DeployedFixture.sol";

/// Issue #7: the on-chain asset index, packages/shared/src/assets.ts and the live feeds all agree.
contract AssetIndexForkTest is DeployedFixture {
    string[5] internal IDS = ["BTC", "ETH", "SOL", "XRP", "GOLD"];
    string[5] internal DESCRIPTIONS = ["BTC / USDT", "ETH / USDT", "SOL / USDT", "XRP / USDT", "Gold / USD"];

    function test_enumIndexes() public pure {
        assertEq(uint8(QieFeeds.Asset.BTC), 0);
        assertEq(uint8(QieFeeds.Asset.ETH), 1);
        assertEq(uint8(QieFeeds.Asset.SOL), 2);
        assertEq(uint8(QieFeeds.Asset.XRP), 3);
        assertEq(uint8(QieFeeds.Asset.GOLD), 4);
        assertEq(QieFeeds.COUNT, uint8(type(QieFeeds.Asset).max) + 1);
    }

    /// Reads assets.ts itself, so editing either side alone fails here.
    function test_contractMatchesAssetsTs() public view {
        string[] memory rows = vm.split(vm.readFile("../shared/src/assets.ts"), "{ id: ");
        assertEq(rows.length, 6, "assets.ts should list exactly 5 assets");
        for (uint8 a; a < 5; ++a) {
            string memory row = rows[uint256(a) + 1];
            string memory idAndIndex = string.concat('"', IDS[a], '", index: ', vm.toString(a), ",");
            string memory feed = string.concat('feed: "', vm.toString(d.paperLedger.feed(a)), '"');
            string memory age = string.concat("maxAgeSeconds: ", vm.toString(d.paperLedger.maxAge(a)), " }");

            assertTrue(vm.contains(row, idAndIndex), string.concat("id/index differs: ", IDS[a]));
            assertTrue(vm.contains(row, feed), string.concat("feed differs: ", IDS[a]));
            assertTrue(vm.contains(row, age), string.concat("max age differs: ", IDS[a]));
        }
    }

    function test_liveDescriptionsMatchTheIndex() public view {
        for (uint8 a; a < 5; ++a) {
            IAggregatorV3 feed = IAggregatorV3(d.paperLedger.feed(a));
            assertEq(feed.description(), DESCRIPTIONS[a]);
            assertEq(feed.decimals(), 8);
        }
    }
}
