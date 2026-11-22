// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {BotForwarder} from "../src/BotForwarder.sol";

/// Deploys BotFolio's contracts to QIE mainnet (chain 1990) or a local fork of it (docs/anvil-fork.md).
///
/// Simulate (no key, nothing sent):
///   forge script script/Deploy.s.sol --fork-url qie
/// The script never reads a private key. A real deploy passes the signer to forge on the command line.
contract Deploy is Script {
    uint256 internal constant QIE_CHAIN_ID = 1990;

    error WrongChain(uint256 chainId);

    function run() external returns (BotForwarder forwarder) {
        if (block.chainid != QIE_CHAIN_ID) revert WrongChain(block.chainid);

        vm.startBroadcast();
        forwarder = new BotForwarder();
        vm.stopBroadcast();

        console2.log("FORWARDER_ADDRESS=%s", address(forwarder));
    }
}
