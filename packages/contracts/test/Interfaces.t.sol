// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {IBotForwarder} from "../src/interfaces/IBotForwarder.sol";
import {IERC5267} from "@openzeppelin/contracts/interfaces/IERC5267.sol";
import {IPaperLedger} from "../src/interfaces/IPaperLedger.sol";

/// Issue #4: the forwarder interface must match OZ 5.0.2's ABI exactly, because BotForwarder is the
/// unchanged OZ contract and other packages build requests from IBotForwarder.
contract InterfacesTest is Test {
    function test_forwarderSelectorsMatchOZ() public pure {
        assertEq(IBotForwarder.verify.selector, ERC2771Forwarder.verify.selector);
        assertEq(IBotForwarder.execute.selector, ERC2771Forwarder.execute.selector);
        assertEq(IBotForwarder.executeBatch.selector, ERC2771Forwarder.executeBatch.selector);
        assertEq(IBotForwarder.nonces.selector, bytes4(keccak256("nonces(address)")));
        assertEq(IERC5267.eip712Domain.selector, bytes4(keccak256("eip712Domain()")));
        assertEq(IBotForwarder.ExecutedForwardRequest.selector, ERC2771Forwarder.ExecutedForwardRequest.selector);
    }

    /// The SkipReason order is part of the frozen interface (events.md documents 0..4).
    function test_skipReasonOrder() public pure {
        assertEq(uint8(IPaperLedger.SkipReason.STALE), 0);
        assertEq(uint8(IPaperLedger.SkipReason.LIMIT), 1);
        assertEq(uint8(IPaperLedger.SkipReason.INACTIVE), 2);
        assertEq(uint8(IPaperLedger.SkipReason.ZERO), 3);
        assertEq(uint8(IPaperLedger.SkipReason.USED), 4);
    }
}
