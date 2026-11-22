// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IBotRegistry} from "../../src/interfaces/IBotRegistry.sol";
import {IChallenges} from "../../src/interfaces/IChallenges.sol";
import {IDailyCall} from "../../src/interfaces/IDailyCall.sol";
import {IPaperLedger} from "../../src/interfaces/IPaperLedger.sol";
import {ISeasonLedger} from "../../src/interfaces/ISeasonLedger.sol";
import {DeployedFixture} from "./DeployedFixture.sol";

/// The 8 calls on the relayer's allowlist (SPEC §11), on top of a full deploy with S0 open.
abstract contract UserActions is DeployedFixture {
    address internal friend;
    uint256 internal friendPk;

    function setUp() public virtual override {
        super.setUp();
        (friend, friendPk) = makeAddrAndKey("botfolio.friend");
        vm.prank(cfg.committer);
        d.seasonLedger.openSeason(0, uint64(block.timestamp), uint64(block.timestamp + 2 days));
    }

    function _createBotAs(address who) internal returns (uint256) {
        vm.prank(who);
        return d.registry.createBot("persona", 5000, 8);
    }

    function _createBotData() internal pure returns (bytes memory) {
        return abi.encodeCall(IBotRegistry.createBot, (keccak256("persona"), 2500, 4));
    }

    function _setActiveData(uint256 bot) internal pure returns (bytes memory) {
        return abi.encodeCall(IBotRegistry.setActive, (bot, false));
    }

    function _commitData(uint256 bot) internal pure returns (bytes memory) {
        return abi.encodeCall(ISeasonLedger.commitVersion, (bot, 2, keccak256("config"), 2000, 3));
    }

    function _correctionData(uint256 bot) internal pure returns (bytes memory) {
        return abi.encodeCall(
            ISeasonLedger.recordCorrection, (bot, keccak256("decision"), keccak256("too risky"), 1)
        );
    }

    function _approveData(uint256 bot, uint8 asset, uint16 bps) internal view returns (bytes memory) {
        IPaperLedger.ApprovedOrder memory o = IPaperLedger.ApprovedOrder(
            bot, asset, true, bps, keccak256("big move"), 0, uint64(block.timestamp + 2 hours)
        );
        bytes memory sig = _sign(runnerPk, d.paperLedger.hashApprovedOrder(o));
        return abi.encodeCall(IPaperLedger.executeApproved, (o, sig));
    }

    function _dailyData(uint256 bot) internal view returns (bytes memory) {
        bytes memory sig = _sign(runnerPk, d.dailyCall.hashBotView(bot, d.dailyCall.today(), false));
        return abi.encodeCall(IDailyCall.call, (bot, true, false, sig));
    }

    function _challengeData(uint256 bot) internal pure returns (bytes memory) {
        return abi.encodeCall(IChallenges.create, (bot, 0));
    }

    function _acceptData(bytes32 code, uint256 bot) internal pure returns (bytes memory) {
        return abi.encodeCall(IChallenges.accept, (code, bot));
    }
}
