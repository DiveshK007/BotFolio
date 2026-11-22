// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title QieFeeds
/// @notice The only five QIE oracle feeds BotFolio uses, with their max price ages (SPEC §0.2, §5).
/// @dev These are constants in bytecode: no setter and no storage slot, so nobody, admin included,
///      can swap a price source. A changed feed address means redeploying (SPEC §4.6).
///      The addresses and index order match `packages/shared/src/assets.ts`.
library QieFeeds {
    /// The on-chain `uint8 asset` index.
    enum Asset {
        BTC,
        ETH,
        SOL,
        XRP,
        GOLD
    }

    uint8 internal constant COUNT = 5;

    address internal constant BTC_USDT = 0x9E596d809a20A272c788726f592c0d1629755440;
    address internal constant ETH_USDT = 0x4bb7012Fbc79fE4Ae9B664228977b442b385500d;
    address internal constant SOL_USDT = 0xe86999c8e6C8eeF71bebd35286bCa674E0AD7b21;
    address internal constant XRP_USDT = 0x804582B1f8Fea73919e7c737115009f668f97528;
    address internal constant GOLD_USD = 0x9aD0199a67588ee293187d26bA1BE61cb07A214c;

    uint32 internal constant CRYPTO_MAX_AGE = 1800; // 30 min
    uint32 internal constant GOLD_MAX_AGE = 21_600; // 6 h

    /// @return The feed, or address(0) for an index above 4.
    function feedOf(uint8 asset) internal pure returns (address) {
        if (asset == uint8(Asset.BTC)) return BTC_USDT;
        if (asset == uint8(Asset.ETH)) return ETH_USDT;
        if (asset == uint8(Asset.SOL)) return SOL_USDT;
        if (asset == uint8(Asset.XRP)) return XRP_USDT;
        if (asset == uint8(Asset.GOLD)) return GOLD_USD;
        return address(0);
    }

    function maxAgeOf(uint8 asset) internal pure returns (uint32) {
        return asset == uint8(Asset.GOLD) ? GOLD_MAX_AGE : CRYPTO_MAX_AGE;
    }
}
