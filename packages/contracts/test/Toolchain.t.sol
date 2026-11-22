// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/// Issue #3 smoke test: proves the pinned toolchain (solc 0.8.24, evm shanghai,
/// OZ 5.0.2, forge-std) compiles and runs. Not a product test; delete once real
/// contract tests exist.
contract ToolchainTest is Test {
    function test_ozForwarderDeploysOnShanghai() public {
        ERC2771Forwarder fwd = new ERC2771Forwarder("BotFolio");
        (, string memory name, string memory version,,,,) = fwd.eip712Domain();
        assertEq(name, "BotFolio");
        assertEq(version, "1");
    }
}
