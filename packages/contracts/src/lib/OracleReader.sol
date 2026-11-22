// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/// @title OracleReader
/// @notice Reads a feed without ever reverting, and applies the validity rules of SPEC §5.3.
/// @dev Why a raw `staticcall` and not `try/catch`: a try/catch does not catch return data that is
///      too short or has dirty upper bits, because that fails while decoding in the caller. One
///      broken feed would then revert a whole batch, which SPEC §4.3 forbids.
library OracleReader {
    struct Round {
        uint80 roundId;
        uint256 price; // 0 = no usable answer
        uint256 updatedAt;
        bool complete; // answeredInRound >= roundId, or the feed reported 0
    }

    /// Highest price accepted, about 184 billion USDT at 8 decimals. Anything above is a broken feed.
    /// The bound also keeps every multiplication in PaperLedger from overflowing.
    uint256 internal constant MAX_PRICE = type(uint64).max;

    function latest(address feed) internal view returns (Round memory round) {
        (bool success, bytes memory data) = feed.staticcall(abi.encodeCall(IAggregatorV3.latestRoundData, ()));
        if (!success || data.length != 160) return round;

        (uint256 roundId, int256 answer,, uint256 updatedAt, uint256 answeredInRound) =
            abi.decode(data, (uint256, int256, uint256, uint256, uint256));
        if (roundId > type(uint80).max || answer <= 0 || uint256(answer) > MAX_PRICE) return round;

        round.roundId = uint80(roundId);
        round.price = uint256(answer);
        round.updatedAt = updatedAt;
        // All 5 live feeds returned answeredInRound == roundId on Nov 21 2026. A feed returning 0 here
        // is UNVERIFIED behaviour, and SPEC §5.3 says to ignore the check in that case.
        round.complete = answeredInRound == 0 || answeredInRound >= roundId;
    }

    /// A round that may be traded on. A timestamp in the future counts as invalid.
    function isFresh(Round memory round, uint256 maxAge) internal view returns (bool) {
        if (round.price == 0 || !round.complete || round.updatedAt == 0) return false;
        if (round.updatedAt > block.timestamp) return false;
        return block.timestamp - round.updatedAt <= maxAge;
    }
}
