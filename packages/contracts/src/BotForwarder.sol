// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/// @title BotForwarder
/// @notice The ERC-2771 forwarder for every BotFolio user action (SPEC §4.1). The user signs, the
///         relayer pays gas, and the target contract sees the user as `_msgSender()`.
/// @dev OpenZeppelin 5.0.2 logic, unchanged. Only the EIP-712 name is ours: "BotFolio", version "1".
///      The ABI is `IBotForwarder`. It can't inherit that interface because OZ declares its own
///      request struct, so `test/Interfaces.t.sol` pins the selectors instead.
contract BotForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("BotFolio") {}
}
