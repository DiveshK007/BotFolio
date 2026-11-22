// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ForwardSigner} from "./ForwardSigner.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";

/// Base for every test: a QIE mainnet fork with the real feed addresses.
///
/// The live feeds are often stale (Nov 22 13:13 IST: XRP 143 min, Gold 774 min) and CI can run at any
/// hour, so no test may depend on either. `setUp` therefore:
///   1. remembers each feed's real latest round,
///   2. moves the clock to 12:00 IST on the day after the fork block,
///   3. mocks `latestRoundData` at the real addresses to return that real price, updated now.
/// A test that wants the untouched feed calls `_useRealFeeds()` and warps relative to its `updatedAt`.
abstract contract ForkTest is ForwardSigner {
    uint256 internal constant IST_OFFSET = 19_800;
    uint8 internal constant BTC = 0;
    uint8 internal constant ETH = 1;
    uint8 internal constant SOL = 2;
    uint8 internal constant XRP = 3;
    uint8 internal constant GOLD = 4;

    /// Copied from SPEC §0.2 / packages/shared/src/assets.ts, not from src/, so tests cross-check src/.
    address[5] internal FEEDS = [
        0x9E596d809a20A272c788726f592c0d1629755440,
        0x4bb7012Fbc79fE4Ae9B664228977b442b385500d,
        0xe86999c8e6C8eeF71bebd35286bCa674E0AD7b21,
        0x804582B1f8Fea73919e7c737115009f668f97528,
        0x9aD0199a67588ee293187d26bA1BE61cb07A214c
    ];
    uint256[5] internal MAX_AGES = [uint256(1800), 1800, 1800, 1800, 21_600];

    uint80[5] internal realRound;
    int256[5] internal realPrice;
    uint256[5] internal realUpdatedAt;

    function setUp() public virtual {
        _forkQie();
        for (uint8 a; a < 5; ++a) {
            (realRound[a], realPrice[a],, realUpdatedAt[a],) = IAggregatorV3(FEEDS[a]).latestRoundData();
            assertGt(realPrice[a], 0, "live feed has no price");
        }
        _warpIst(_day(block.timestamp) + 1, 12 hours);
    }

    /// `--fork-url` (and CI's ETH_RPC_URL) already puts us on QIE. A plain `forge test` forks here.
    function _forkQie() private {
        if (block.chainid == 1990) return;
        string[4] memory urls = [
            vm.envOr("QIE_RPC_URL", string("qie")),
            "qie",
            "https://rpc4mainnet.qie.digital",
            "https://rpc5mainnet.qie.digital"
        ];
        for (uint256 i; i < urls.length; ++i) {
            try vm.createSelectFork(urls[i]) returns (uint256) {
                if (block.chainid == 1990) return;
            } catch {}
        }
        revert("no QIE mainnet RPC answered (rpc3, rpc4, rpc5)");
    }

    function _day(uint256 timestamp) internal pure returns (uint32) {
        return uint32((timestamp + IST_OFFSET) / 1 days);
    }

    function _istTime(uint32 day, uint256 secondsIntoDay) internal pure returns (uint256) {
        return uint256(day) * 1 days - IST_OFFSET + secondsIntoDay;
    }

    /// Moves the clock and refreshes every mocked price.
    function _warpIst(uint32 day, uint256 secondsIntoDay) internal {
        vm.warp(_istTime(day, secondsIntoDay));
        _freshAll();
    }

    function _freshAll() internal {
        for (uint8 a; a < 5; ++a) {
            _setPrice(a, realPrice[a], block.timestamp);
        }
    }

    function _setPrice(uint8 asset, int256 answer, uint256 updatedAt) internal {
        _setRound(asset, realRound[asset], answer, updatedAt, realRound[asset]);
    }

    function _setAge(uint8 asset, uint256 age) internal {
        _setPrice(asset, realPrice[asset], block.timestamp - age);
    }

    function _setRound(uint8 asset, uint80 round, int256 answer, uint256 updatedAt, uint80 answeredIn)
        internal
    {
        vm.mockCall(
            FEEDS[asset],
            abi.encodeCall(IAggregatorV3.latestRoundData, ()),
            abi.encode(round, answer, updatedAt, updatedAt, answeredIn)
        );
    }

    function _useRealFeeds() internal {
        vm.clearMockedCalls();
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}
