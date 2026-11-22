// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";

/// @title ForwarderAccess
/// @notice Base for the five user-facing contracts: AccessControl roles plus ERC-2771 user identity.
/// @dev Both OZ parents define `_msgSender()`, so this contract picks ERC2771Context's. That also makes
///      every role check use the signer of a forwarded request, never the forwarder or the relayer.
abstract contract ForwarderAccess is ERC2771Context, AccessControl {
    /// @notice A constructor address was zero.
    error ZeroAddress();

    /// @param forwarder_ The BotForwarder. Immutable inside ERC2771Context.
    /// @param admin Holder of DEFAULT_ADMIN_ROLE.
    constructor(address forwarder_, address admin) ERC2771Context(forwarder_) {
        if (forwarder_ == address(0) || admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function _msgSender() internal view virtual override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view virtual override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength()
        internal
        view
        virtual
        override(Context, ERC2771Context)
        returns (uint256)
    {
        return ERC2771Context._contextSuffixLength();
    }
}
