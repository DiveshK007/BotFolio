// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {IBotRegistry} from "../src/interfaces/IBotRegistry.sol";
import {IPaperLedger} from "../src/interfaces/IPaperLedger.sol";
import {ISeasonLedger} from "../src/interfaces/ISeasonLedger.sol";
import {Roles} from "../src/lib/Roles.sol";
import {DeployedFixture} from "./utils/DeployedFixture.sol";

/// Issue #187 (and the wiring part of #17): the real deploy script on a QIE mainnet fork.
contract DeployForkTest is DeployedFixture {
    function test_everythingIsDeployedOnChain1990() public view {
        address[7] memory all = _all();
        for (uint256 i; i < all.length; ++i) {
            assertGt(all[i].code.length, 0);
            for (uint256 j = i + 1; j < all.length; ++j) {
                assertTrue(all[i] != all[j]);
            }
        }
        (,,, uint256 chainId,,,) = d.forwarder.eip712Domain();
        assertEq(chainId, 1990);
    }

    function test_addressesAreWired() public view {
        assertEq(d.registry.paperLedger(), address(d.paperLedger));
        assertEq(d.paperLedger.registry(), address(d.registry));
        assertEq(d.seasonLedger.registry(), address(d.registry));
        assertEq(d.dailyCall.registry(), address(d.registry));
        assertEq(d.challenges.registry(), address(d.registry));
        assertEq(d.challenges.seasonLedger(), address(d.seasonLedger));

        address fwd = address(d.forwarder);
        assertEq(d.registry.trustedForwarder(), fwd);
        assertEq(d.paperLedger.trustedForwarder(), fwd);
        assertEq(d.seasonLedger.trustedForwarder(), fwd);
        assertEq(d.dailyCall.trustedForwarder(), fwd);
        assertEq(d.challenges.trustedForwarder(), fwd);
    }

    function test_defaultStartCash() public view {
        assertEq(d.paperLedger.START_CASH_E8(), 1078e8);
    }

    /// Replays the deploy's RoleGranted/RoleRevoked logs, so a grant nobody expected can't hide.
    /// 6 admins + 2 runner + 4 committer + 2 contract-to-contract = 14 live grants, and no others.
    function test_exactlyTheExpectedRolesExist() public view {
        assertEq(liveGrants, 14);

        assertTrue(d.paperLedger.hasRole(Roles.REGISTRY, address(d.registry)));
        assertTrue(d.registry.hasRole(Roles.SEASON_LEDGER, address(d.seasonLedger)));
        assertTrue(d.paperLedger.hasRole(Roles.RUNNER, cfg.runner));
        assertTrue(d.dailyCall.hasRole(Roles.RUNNER, cfg.runner));
        assertTrue(d.seasonLedger.hasRole(Roles.COMMITTER, cfg.committer));
        assertTrue(d.trust.hasRole(Roles.COMMITTER, cfg.committer));
        assertTrue(d.dailyCall.hasRole(Roles.COMMITTER, cfg.committer));
        assertTrue(d.challenges.hasRole(Roles.COMMITTER, cfg.committer));
        address[6] memory managed = _managed();
        for (uint256 i; i < managed.length; ++i) {
            assertTrue(IAccessControl(managed[i]).hasRole(bytes32(0), cfg.admin));
        }
    }

    function test_relayerDeployerAndForwarderHaveNoRole() public view {
        bytes32[5] memory roles =
            [bytes32(0), Roles.RUNNER, Roles.COMMITTER, Roles.REGISTRY, Roles.SEASON_LEDGER];
        address[3] memory nobodies = [cfg.relayer, deployer, address(d.forwarder)];
        address[6] memory managed = _managed();
        for (uint256 c; c < managed.length; ++c) {
            for (uint256 r; r < roles.length; ++r) {
                for (uint256 n; n < nobodies.length; ++n) {
                    assertFalse(IAccessControl(managed[c]).hasRole(roles[r], nobodies[n]));
                }
            }
        }
    }

    /// The flow #187 asks for: createBot -> initPortfolio -> commitVersion -> setLimits.
    function test_createBotThenCommitVersion() public {
        vm.expectCall(address(d.paperLedger), abi.encodeCall(IPaperLedger.initPortfolio, (1)), 1);
        _forward(
            d.forwarder,
            userPk,
            address(d.registry),
            abi.encodeCall(IBotRegistry.createBot, ("persona", 2500, 4))
        );

        (uint128 cash,,, bool init) = d.paperLedger.portfolios(1);
        assertTrue(init);
        assertEq(cash, 1078e8);
        assertEq(d.registry.getBot(1).owner, user);

        vm.expectCall(address(d.registry), abi.encodeCall(IBotRegistry.setLimits, (1, 1500, 2)), 1);
        _forward(
            d.forwarder,
            userPk,
            address(d.seasonLedger),
            abi.encodeCall(ISeasonLedger.commitVersion, (1, 2, "config", 1500, 2))
        );

        IBotRegistry.Bot memory b = d.registry.getBot(1);
        assertEq(b.version, 2);
        assertEq(b.maxPerCoinBps, 1500);
        assertEq(b.maxTradesPerDay, 2);
    }

    function test_runnerCanTradeAfterDeploy() public {
        vm.prank(user);
        uint256 bot = d.registry.createBot("persona", 2500, 4);
        IPaperLedger.Order[] memory batch = new IPaperLedger.Order[](1);
        batch[0] = IPaperLedger.Order(bot, GOLD, true, 1000, "debut", 0);
        vm.prank(cfg.runner);
        d.paperLedger.executeBatch(batch);
        assertGt(d.paperLedger.unitsE18(bot, GOLD), 0);
    }

    function test_coldKeyCanStillAdminister() public {
        vm.prank(cfg.admin);
        d.paperLedger.revokeRole(Roles.RUNNER, cfg.runner);
        assertFalse(d.paperLedger.hasRole(Roles.RUNNER, cfg.runner));
    }

    /// When the cold key itself deploys, it keeps admin and nothing is renounced.
    function test_deployerAsColdKey() public {
        Deploy.Config memory c = cfg;
        c.admin = deployer;
        Deploy.Deployment memory again = script.runWith(c);
        assertTrue(again.registry.hasRole(bytes32(0), deployer));
        assertTrue(again.challenges.hasRole(bytes32(0), deployer));
    }

    function test_rejectsWrongChain() public {
        vm.chainId(1983);
        vm.expectRevert(abi.encodeWithSelector(Deploy.WrongChain.selector, 1983));
        script.runWith(cfg);
    }

    function test_rejectsSharedKeys() public {
        Deploy.Config memory c = cfg;
        c.relayer = c.runner;
        _expectBadConfig(c);
    }

    function test_rejectsZeroAddress() public {
        Deploy.Config memory c = cfg;
        c.committer = address(0);
        _expectBadConfig(c);
    }

    function test_rejectsDeployerAsHotWallet() public {
        Deploy.Config memory c = cfg;
        c.runner = deployer;
        _expectBadConfig(c);
    }

    function test_rejectsZeroStartCash() public {
        Deploy.Config memory c = cfg;
        c.startCashE8 = 0;
        _expectBadConfig(c);
    }

    function _expectBadConfig(Deploy.Config memory c) internal {
        vm.expectPartialRevert(Deploy.BadConfig.selector);
        script.runWith(c);
    }
}
