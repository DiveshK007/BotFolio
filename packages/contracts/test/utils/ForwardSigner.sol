// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// Plays the two off-chain parties of a relayed action: the user signs an EIP-712 ForwardRequest,
/// the relayer (which has no role anywhere) submits it and pays gas.
abstract contract ForwardSigner is Test {
    bytes32 internal constant FORWARD_TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
    );
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// The relayer's cap in SPEC §11. Using it here means every forwarded test also proves the cap is enough.
    uint256 internal constant RELAY_GAS = 300_000;

    address internal relayer = makeAddr("botfolio.relayer");

    function _request(ERC2771Forwarder fwd, uint256 pk, address to, bytes memory data)
        internal
        view
        returns (ERC2771Forwarder.ForwardRequestData memory)
    {
        return _requestWithGas(fwd, pk, to, data, RELAY_GAS);
    }

    function _requestWithGas(ERC2771Forwarder fwd, uint256 pk, address to, bytes memory data, uint256 gas_)
        internal
        view
        returns (ERC2771Forwarder.ForwardRequestData memory r)
    {
        r.from = vm.addr(pk);
        r.to = to;
        r.gas = gas_;
        r.deadline = uint48(block.timestamp + 10 minutes);
        r.data = data;

        bytes32 structHash = keccak256(
            abi.encode(
                FORWARD_TYPEHASH,
                r.from,
                r.to,
                r.value,
                r.gas,
                fwd.nonces(r.from),
                r.deadline,
                keccak256(data)
            )
        );
        (uint8 v, bytes32 rr, bytes32 s) =
            vm.sign(pk, MessageHashUtils.toTypedDataHash(_domain("BotFolio", address(fwd)), structHash));
        r.signature = abi.encodePacked(rr, s, v);
    }

    function _forward(ERC2771Forwarder fwd, uint256 pk, address to, bytes memory data) internal {
        ERC2771Forwarder.ForwardRequestData memory r = _request(fwd, pk, to, data);
        assertTrue(fwd.verify(r), "forwarder.verify");
        vm.prank(relayer);
        fwd.execute(r);
    }

    /// Domain separator built by hand with a literal 1990, so tests don't copy the contract's own maths.
    function _domain(string memory name, address verifyingContract) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256("1"), uint256(1990), verifyingContract
            )
        );
    }
}
