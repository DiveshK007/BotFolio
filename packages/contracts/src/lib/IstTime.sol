// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IstTime
/// @notice India Standard Time days. IST is UTC+5:30 all year, so a fixed offset is exact.
library IstTime {
    uint256 internal constant OFFSET = 19_800;

    function dayOf(uint256 timestamp) internal pure returns (uint256) {
        return (timestamp + OFFSET) / 1 days;
    }

    /// The unix time that is `secondsIntoDay` seconds after 00:00 IST of `day`.
    function timeAt(uint256 day, uint256 secondsIntoDay) internal pure returns (uint256) {
        return day * 1 days + secondsIntoDay - OFFSET;
    }
}
