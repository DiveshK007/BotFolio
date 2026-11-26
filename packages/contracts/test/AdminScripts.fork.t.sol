// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {AdminScript, CloseSeason, OpenSeason, PublishRules, SeedHouseBots} from "../script/Admin.s.sol";
import {IBotRegistry} from "../src/interfaces/IBotRegistry.sol";
import {ISeasonLedger} from "../src/interfaces/ISeasonLedger.sol";
import {Roles} from "../src/lib/Roles.sol";
import {DeployedFixture} from "./utils/DeployedFixture.sol";

/// Issue #29: the admin scripts against a full deploy. Scripts broadcast as forge's default sender,
/// so that account gets the two roles here.
contract AdminScriptsForkTest is DeployedFixture {
    uint256 internal constant S0_START = 1_795_458_600; // Nov 24 2026 00:00 IST
    uint256 internal constant S0_END = 1_795_620_600; // Nov 25 2026 21:00 IST
    string internal constant URI = "https://example.com/trust-rules.md";
    bytes32 internal constant DOC = keccak256("rules doc");

    OpenSeason internal opener;
    CloseSeason internal closer;
    PublishRules internal publisher;

    function setUp() public override {
        super.setUp();
        opener = new OpenSeason();
        closer = new CloseSeason();
        publisher = new PublishRules();
        vm.startPrank(cfg.admin);
        d.seasonLedger.grantRole(Roles.COMMITTER, deployer);
        d.trust.grantRole(bytes32(0), deployer);
        d.registry.grantRole(bytes32(0), deployer);
        vm.stopPrank();
    }

    function _houseInputs()
        internal
        pure
        returns (bytes32[] memory h, uint256[] memory bps, uint256[] memory trades)
    {
        h = new bytes32[](3);
        bps = new uint256[](3);
        trades = new uint256[](3);
        (h[0], h[1], h[2]) = (keccak256("sam"), keccak256("granny"), keccak256("max"));
        (bps[0], bps[1], bps[2]) = (2500, 5000, 2500);
        (trades[0], trades[1], trades[2]) = (8, 4, 8);
    }

    function test_seedHouseBots() public {
        SeedHouseBots seeder = new SeedHouseBots();
        (bytes32[] memory h, uint256[] memory bps, uint256[] memory trades) = _houseInputs();
        seeder.runWith(d.registry, h, bps, trades);
        for (uint256 i; i < 3; ++i) {
            IBotRegistry.Bot memory b = d.registry.getBot(i + 1);
            assertTrue(b.house);
            assertEq(b.personaHash, h[i]);
            assertEq(b.maxPerCoinBps, bps[i]);
            assertEq(b.maxTradesPerDay, trades[i]);
        }
        vm.expectRevert(abi.encodeWithSelector(AdminScript.BadInput.selector, "registry already has bots"));
        seeder.runWith(d.registry, h, bps, trades);
    }

    function test_openSeasonZero() public {
        opener.runWith(d.seasonLedger, 0, S0_START, S0_END);
        (uint64 start, uint64 end,,, bool closed) = d.seasonLedger.seasons(0);
        assertEq(start, S0_START);
        assertEq(end, S0_END);
        assertFalse(closed);
    }

    /// The README's timestamps are what SPEC §1 says: 00:00 IST Nov 24 to 21:00 IST Nov 25.
    function test_seasonZeroTimestampsAreIst() public pure {
        assertEq((S0_START + IST_OFFSET) % 1 days, 0);
        assertEq(S0_END - S0_START, 1 days + 21 hours);
    }

    function test_openRefusesWrongNumber() public {
        _expectBadInput();
        opener.runWith(d.seasonLedger, 1, S0_START, S0_END);
    }

    function test_openRefusesMilliseconds() public {
        _expectBadInput();
        opener.runWith(d.seasonLedger, 0, S0_START * 1000, S0_END * 1000);
    }

    function test_openRefusesBackwardsTimes() public {
        _expectBadInput();
        opener.runWith(d.seasonLedger, 0, S0_END, S0_START);
    }

    function test_openNeedsCommitter() public {
        vm.prank(cfg.admin);
        d.seasonLedger.revokeRole(Roles.COMMITTER, deployer);
        vm.expectPartialRevert(IAccessControl.AccessControlUnauthorizedAccount.selector);
        opener.runWith(d.seasonLedger, 0, S0_START, S0_END);
    }

    function test_closeSeason() public {
        opener.runWith(d.seasonLedger, 0, S0_START, S0_END);
        vm.warp(S0_END);
        closer.runWith(d.seasonLedger, 0, keccak256("root"), "https://example.com/season-0.jsonl");
        assertEq(uint8(d.seasonLedger.seasonState(0)), uint8(ISeasonLedger.SeasonState.CLOSED));
    }

    function test_closeRefusesEarly() public {
        opener.runWith(d.seasonLedger, 0, S0_START, S0_END);
        vm.warp(S0_END - 1);
        _expectBadInput();
        closer.runWith(d.seasonLedger, 0, keccak256("root"), "https://example.com/season-0.jsonl");
    }

    function test_closeRefusesEmptyRootOrUri() public {
        opener.runWith(d.seasonLedger, 0, S0_START, S0_END);
        vm.warp(S0_END);
        _expectBadInput();
        closer.runWith(d.seasonLedger, 0, bytes32(0), "https://example.com/season-0.jsonl");
        _expectBadInput();
        closer.runWith(d.seasonLedger, 0, keccak256("root"), "");
    }

    function test_publishBothLaunchVersions() public {
        publisher.runWith(d.trust, "trust-v1-sprint", URI, DOC);
        publisher.runWith(d.trust, "trust-v1", URI, DOC);
        assertEq(d.trust.rulesURI(bytes32("trust-v1-sprint")), URI);
        assertEq(d.trust.rulesDocHash(bytes32("trust-v1-sprint")), DOC);
        assertEq(d.trust.rulesURI(bytes32("trust-v1")), URI);
        assertEq(d.trust.rulesDocHash(bytes32("trust-v1")), DOC);
    }

    function test_publishRefusesTypo() public {
        _expectBadInput();
        publisher.runWith(d.trust, "trust-v1-sprnit", URI, DOC);
    }

    function test_publishRefusesTwice() public {
        publisher.runWith(d.trust, "trust-v1", URI, DOC);
        _expectBadInput();
        publisher.runWith(d.trust, "trust-v1", URI, DOC);
    }

    function test_refusesOtherChains() public {
        vm.chainId(1983);
        vm.expectRevert(abi.encodeWithSelector(AdminScript.WrongChain.selector, 1983));
        opener.runWith(d.seasonLedger, 0, S0_START, S0_END);
    }

    function _expectBadInput() internal {
        vm.expectPartialRevert(AdminScript.BadInput.selector);
    }
}
