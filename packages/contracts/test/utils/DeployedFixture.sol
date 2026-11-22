// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Vm} from "forge-std/Vm.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {ForkTest} from "./ForkTest.sol";

/// All 7 contracts, deployed and wired by the real deploy script on the fork.
abstract contract DeployedFixture is ForkTest {
    Deploy internal script;
    Deploy.Config internal cfg;
    Deploy.Deployment internal d;

    /// forge's default sender is who `vm.startBroadcast()` uses when no key is given.
    address internal deployer;
    uint256 internal runnerPk;
    address internal user;
    uint256 internal userPk;
    /// RoleGranted minus RoleRevoked over the whole deploy.
    int256 internal liveGrants;

    function setUp() public virtual override {
        super.setUp();
        script = new Deploy();
        deployer = tx.origin;
        (user, userPk) = makeAddrAndKey("botfolio.user");

        address runner;
        (runner, runnerPk) = makeAddrAndKey("botfolio.runner");
        cfg = Deploy.Config({
            admin: makeAddr("botfolio.admin"),
            runner: runner,
            committer: makeAddr("botfolio.committer"),
            relayer: relayer,
            startCashE8: script.DEFAULT_START_CASH_E8()
        });

        vm.recordLogs();
        d = script.runWith(cfg);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics.length == 0) continue;
            if (logs[i].topics[0] == IAccessControl.RoleGranted.selector) ++liveGrants;
            if (logs[i].topics[0] == IAccessControl.RoleRevoked.selector) --liveGrants;
        }
    }

    function _all() internal view returns (address[7] memory) {
        return [
            address(d.forwarder),
            address(d.paperLedger),
            address(d.registry),
            address(d.seasonLedger),
            address(d.trust),
            address(d.dailyCall),
            address(d.challenges)
        ];
    }

    function _managed() internal view returns (address[6] memory) {
        return [
            address(d.paperLedger),
            address(d.registry),
            address(d.seasonLedger),
            address(d.trust),
            address(d.dailyCall),
            address(d.challenges)
        ];
    }
}
