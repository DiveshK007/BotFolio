// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {ForwarderAccess} from "../src/base/ForwarderAccess.sol";
import {Roles} from "../src/lib/Roles.sol";
import {ForkTest} from "./utils/ForkTest.sol";

contract RoleHarness is ForwarderAccess {
    address public lastCaller;

    constructor(address forwarder_, address admin) ForwarderAccess(forwarder_, admin) {}

    function runnerOnly() external onlyRole(Roles.RUNNER) {
        lastCaller = _msgSender();
    }
}

/// Issue #17: role ids, and role checks that follow the signer, not the relayer.
contract AccessRolesTest is ForkTest {
    ERC2771Forwarder internal fwd;
    RoleHarness internal c;
    address internal admin = makeAddr("botfolio.admin");
    address internal runner;
    uint256 internal runnerPk;

    function setUp() public override {
        super.setUp();
        (runner, runnerPk) = makeAddrAndKey("botfolio.runner");
        fwd = new ERC2771Forwarder("BotFolio");
        c = new RoleHarness(address(fwd), admin);
        vm.prank(admin);
        c.grantRole(Roles.RUNNER, runner);
    }

    function test_roleIdsMatchEventsMd() public pure {
        assertEq(Roles.RUNNER, keccak256("RUNNER_ROLE"));
        assertEq(Roles.COMMITTER, keccak256("COMMITTER_ROLE"));
        assertEq(Roles.REGISTRY, keccak256("REGISTRY_ROLE"));
        assertEq(Roles.SEASON_LEDGER, keccak256("SEASON_LEDGER_ROLE"));
    }

    function test_onlyAdminGetsAdminRole() public view {
        assertTrue(c.hasRole(bytes32(0), admin));
        assertFalse(c.hasRole(bytes32(0), address(this)), "the deploying account gets nothing by itself");
        assertFalse(c.hasRole(bytes32(0), runner));
        assertFalse(c.hasRole(bytes32(0), address(fwd)));
    }

    function test_relayerHasNoRole() public view {
        bytes32[5] memory roles =
            [bytes32(0), Roles.RUNNER, Roles.COMMITTER, Roles.REGISTRY, Roles.SEASON_LEDGER];
        for (uint256 i; i < roles.length; ++i) {
            assertFalse(c.hasRole(roles[i], relayer));
            assertFalse(c.hasRole(roles[i], address(fwd)));
        }
    }

    function test_relayerCannotCallARoleFunctionItself() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, relayer, Roles.RUNNER
            )
        );
        vm.prank(relayer);
        c.runnerOnly();
    }

    function test_roleCheckUsesSignerOfForwardedRequest() public {
        _forward(fwd, runnerPk, address(c), abi.encodeCall(RoleHarness.runnerOnly, ()));
        assertEq(c.lastCaller(), runner);
    }

    function test_unprivilegedSignerFailsThroughForwarder() public {
        (, uint256 userPk) = makeAddrAndKey("botfolio.user");
        ERC2771Forwarder.ForwardRequestData memory r =
            _request(fwd, userPk, address(c), abi.encodeCall(RoleHarness.runnerOnly, ()));
        vm.expectRevert();
        vm.prank(relayer);
        fwd.execute(r);
        assertEq(c.lastCaller(), address(0));
    }

    /// Appending an address to calldata only counts when the caller really is the forwarder.
    function test_cannotSpoofSenderWithCalldataSuffix() public {
        vm.prank(relayer);
        (bool ok,) = address(c).call(abi.encodePacked(abi.encodeCall(RoleHarness.runnerOnly, ()), runner));
        assertFalse(ok);
        assertEq(c.lastCaller(), address(0));
    }

    function test_onlyAdminGrants() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, runner, bytes32(0)
            )
        );
        vm.prank(runner);
        c.grantRole(Roles.RUNNER, relayer);
    }

    function test_revokedRoleStopsWorking() public {
        vm.prank(admin);
        c.revokeRole(Roles.RUNNER, runner);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, runner, Roles.RUNNER
            )
        );
        vm.prank(runner);
        c.runnerOnly();
    }

    function test_zeroAddressesRejected() public {
        vm.expectRevert(ForwarderAccess.ZeroAddress.selector);
        new RoleHarness(address(0), admin);
        vm.expectRevert(ForwarderAccess.ZeroAddress.selector);
        new RoleHarness(address(fwd), address(0));
    }
}
