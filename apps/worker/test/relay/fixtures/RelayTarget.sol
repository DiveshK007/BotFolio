// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";

/// TEST ONLY, for the relayer's Anvil run. Same selectors as the allowlist, trivial bodies.
/// Never deployed to a public network.
contract RelayTarget is ERC2771Context {
    error AlreadyHasBot(address owner);
    error PriceTooOld(uint8 asset);

    mapping(address => uint256) public botOf;
    mapping(address => uint256) public actions;
    uint256 public nextBotId = 1;

    constructor(address forwarder) ERC2771Context(forwarder) {}

    function createBot(bytes32, uint16, uint8) external returns (uint256 botId) {
        address owner = _msgSender();
        if (botOf[owner] != 0) revert AlreadyHasBot(owner);
        botId = nextBotId++;
        botOf[owner] = botId;
        actions[owner]++;
    }

    /// botId picks the behaviour under test.
    function setActive(uint256 botId, bool) external {
        if (botId == 404) revert PriceTooOld(2);
        // Passes an eth_call with the default gas, fails at a small request.gas.
        if (botId == 555) require(gasleft() > 250_000, "needs more gas");
        actions[_msgSender()]++;
    }
}
