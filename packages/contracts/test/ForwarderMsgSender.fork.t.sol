// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {IBotRegistry} from "../src/interfaces/IBotRegistry.sol";
import {IChallenges} from "../src/interfaces/IChallenges.sol";
import {IDailyCall} from "../src/interfaces/IDailyCall.sol";
import {IPaperLedger} from "../src/interfaces/IPaperLedger.sol";
import {ISeasonLedger} from "../src/interfaces/ISeasonLedger.sol";
import {UserActions} from "./utils/UserActions.sol";

/// Issue #20: for every user-signed function, `_msgSender()` is the user who signed.
///
/// Each function gets three checks on the real deploy:
///   1. relayed, the signer is the actor (and the relayer pays);
///   2. relayed with someone else's signature, it fails;
///   3. sent by the relayer itself, with or without the user's address glued on, it fails.
/// createBot has no owner to check against, so for it 2 and 3 show who becomes the owner instead.
contract ForwarderMsgSenderForkTest is UserActions {
    function test_createBot() public {
        vm.expectEmit(address(d.registry));
        emit IBotRegistry.BotCreated(1, user, keccak256("persona"), 2500, 4);
        _relay(userPk, address(d.registry), _createBotData());
        assertEq(d.registry.botOf(user), 1);
        assertEq(d.registry.botOf(relayer), 0);
        assertEq(d.registry.botOf(address(d.forwarder)), 0);

        // The suffix trick just makes a bot for the relayer's own address, never for `friend`.
        vm.prank(relayer);
        (bool ok,) = address(d.registry).call(abi.encodePacked(_createBotData(), friend));
        assertTrue(ok);
        assertEq(d.registry.botOf(friend), 0);
        assertEq(d.registry.botOf(relayer), 2);
    }

    function test_setActive() public {
        uint256 bot = _createBotAs(user);
        bytes memory data = _setActiveData(bot);
        _onlyTheOwner(address(d.registry), data);

        vm.expectEmit(address(d.registry));
        emit IBotRegistry.BotActiveChanged(bot, false);
        _relay(userPk, address(d.registry), data);
        assertFalse(d.registry.getBot(bot).active);
        assertFalse(d.registry.banned(bot), "an owner pause is not a ban");
    }

    function test_commitVersion() public {
        uint256 bot = _createBotAs(user);
        bytes memory data = _commitData(bot);
        _onlyTheOwner(address(d.seasonLedger), data);

        vm.expectEmit(address(d.seasonLedger));
        emit ISeasonLedger.VersionCommitted(bot, 2, keccak256("config"), 0);
        _relay(userPk, address(d.seasonLedger), data);
        assertEq(d.registry.getBot(bot).version, 2);
    }

    function test_recordCorrection() public {
        uint256 bot = _createBotAs(user);
        bytes memory data = _correctionData(bot);
        _onlyTheOwner(address(d.seasonLedger), data);

        vm.expectEmit(address(d.seasonLedger));
        emit ISeasonLedger.CallCorrected(bot, keccak256("decision"), keccak256("too risky"), 1, 0);
        _relay(userPk, address(d.seasonLedger), data);
    }

    function test_executeApproved() public {
        uint256 bot = _createBotAs(user);
        bytes memory data = _approveData(bot, ETH, 3500);
        _onlyTheOwner(address(d.paperLedger), data);

        vm.expectEmit(address(d.paperLedger));
        emit IPaperLedger.ApprovedTrade(bot, keccak256("big move"), 0, user);
        _relay(userPk, address(d.paperLedger), data);
        assertGt(d.paperLedger.unitsE18(bot, ETH), 0);
    }

    function test_dailyCall() public {
        uint256 bot = _createBotAs(user);
        bytes memory data = _dailyData(bot);
        _onlyTheOwner(address(d.dailyCall), data);

        vm.expectEmit(address(d.dailyCall));
        emit IDailyCall.Called(bot, _day(block.timestamp), true, false, realPrice[BTC], realRound[BTC]);
        _relay(userPk, address(d.dailyCall), data);
    }

    function test_challengeCreate() public {
        uint256 bot = _createBotAs(user);
        bytes memory data = _challengeData(bot);
        _onlyTheOwner(address(d.challenges), data);

        // The code is derived from _msgSender(), so it also proves who the sender was.
        vm.expectEmit(address(d.challenges));
        emit IChallenges.ChallengeCreated(keccak256(abi.encode(user, uint256(0))), bot, 0);
        _relay(userPk, address(d.challenges), data);
    }

    function test_challengeAccept() public {
        uint256 friendBot = _createBotAs(friend);
        uint256 bot = _createBotAs(user);
        vm.prank(friend);
        bytes32 code = d.challenges.create(friendBot, 0);

        bytes memory data = _acceptData(code, bot);
        _onlyTheOwner(address(d.challenges), data);

        vm.expectEmit(address(d.challenges));
        emit IChallenges.ChallengeAccepted(code, bot);
        _relay(userPk, address(d.challenges), data);
    }

    /// Checks 2 and 3 for a function that only `user` may call.
    function _onlyTheOwner(address target, bytes memory data) internal {
        // 2. someone else signs the same call
        ERC2771Forwarder.ForwardRequestData memory r = _request(d.forwarder, friendPk, target, data);
        vm.prank(relayer);
        (bool ok,) = address(d.forwarder).call(abi.encodeCall(ERC2771Forwarder.execute, (r)));
        assertFalse(ok, "someone else's signature worked");

        // 3. the relayer calls it directly
        vm.prank(relayer);
        (ok,) = target.call(data);
        assertFalse(ok, "the relayer acted as the user");
        vm.prank(relayer);
        (ok,) = target.call(abi.encodePacked(data, user));
        assertFalse(ok, "the relayer spoofed the user");
    }

    /// Check 1. `signer` in the forwarder's own event is the user, and the user sends no tx.
    function _relay(uint256 pk, address target, bytes memory data) internal {
        address signer = vm.addr(pk);
        uint64 txNonce = vm.getNonce(signer);
        uint256 forwardNonce = d.forwarder.nonces(signer);
        _forward(d.forwarder, pk, target, data);
        assertEq(d.forwarder.nonces(signer), forwardNonce + 1);
        assertEq(vm.getNonce(signer), txNonce, "the user sent a transaction");
    }
}
