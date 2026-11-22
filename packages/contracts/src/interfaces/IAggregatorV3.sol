// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IAggregatorV3
/// @notice The Chainlink AggregatorV3 read interface that QIE's oracle feeds expose (SPEC §0.2).
/// @dev Only the read functions BotFolio uses. The 5 feed addresses live in `QieFeeds` and
///      `packages/shared/src/assets.ts`; they are fixed at deploy (SPEC §4.6).
interface IAggregatorV3 {
    /// @notice Number of decimals in `answer`. All 5 BotFolio feeds return 8 (checked Nov 19 2026).
    function decimals() external view returns (uint8);

    /// @notice Human-readable pair, e.g. "BTC / USDT" or "Gold / USD".
    function description() external view returns (string memory);

    /// @notice Data for a past round, used by anyone who wants to recompute a trade or a settlement.
    /// @param roundId The round to read.
    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80 roundId_, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

    /// @notice The latest round. BotFolio contracts read this at execution time; prices are never passed in.
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
