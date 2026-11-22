// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC5267} from "@openzeppelin/contracts/interfaces/IERC5267.sol";

/// @title IBotForwarder
/// @notice ERC-2771 forwarder every user action goes through (SPEC §4.1). Users sign an EIP-712
///         `ForwardRequest`; BotFolio's relayer submits it and pays gas. Users never pay.
/// @dev `BotForwarder` is OpenZeppelin 5.0.2 `ERC2771Forwarder` unchanged, with domain name
///      "BotFolio", version "1", chain id 1990. This interface mirrors that ABI so other
///      packages can import it; a test asserts the selectors match the OZ contract.
///      EIP-712 type signed by the user (OZ 5.0.2):
///      `ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)`
interface IBotForwarder is IERC5267 {
    /// @notice A signed request plus its signature. `nonce` is not in the struct: the forwarder
    ///         uses `nonces(from)` when it checks the signature.
    struct ForwardRequestData {
        address from;
        address to;
        uint256 value;
        uint256 gas;
        uint48 deadline;
        bytes data;
        bytes signature;
    }

    /// @notice Emitted for every executed request. `signer` is the user, not the relayer.
    event ExecutedForwardRequest(address indexed signer, uint256 nonce, bool success);

    /// @notice The recovered signer does not match `request.from`.
    error ERC2771ForwarderInvalidSigner(address signer, address from);
    /// @notice `msg.value` does not match the requested value. BotFolio always sends 0.
    error ERC2771ForwarderMismatchedValue(uint256 requestedValue, uint256 msgValue);
    /// @notice The request's deadline has passed.
    error ERC2771ForwarderExpiredRequest(uint48 deadline);
    /// @notice The target contract does not trust this forwarder.
    error ERC2771UntrustfulTarget(address target, address forwarder);

    /// @notice True if the request is valid now: signature, nonce, deadline and trusted target.
    ///         The relayer calls this (staticcall) before sending (SPEC §11).
    /// @param request The signed request.
    function verify(ForwardRequestData calldata request) external view returns (bool);

    /// @notice Executes one signed request. Reverts if it is invalid; if the inner call reverts,
    ///         this call reverts too.
    /// @param request The signed request. BotFolio's relayer only relays the §11 allowlist.
    function execute(ForwardRequestData calldata request) external payable;

    /// @notice Executes several requests. Not used by BotFolio's relayer (it sends one per tx).
    /// @param requests The signed requests.
    /// @param refundReceiver Where unused value goes; zero address makes any invalid request revert the batch.
    function executeBatch(ForwardRequestData[] calldata requests, address payable refundReceiver)
        external
        payable;

    /// @notice The next nonce `owner` must sign.
    /// @param owner The signer.
    function nonces(address owner) external view returns (uint256);
}
