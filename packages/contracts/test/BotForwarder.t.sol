// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {BotForwarder} from "../src/BotForwarder.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {ForkTest} from "./utils/ForkTest.sol";

contract ForwarderTarget is ERC2771Context {
    address public lastCaller;

    constructor(address fwd) ERC2771Context(fwd) {}

    function ping() external {
        lastCaller = _msgSender();
    }
}

/// Issue #8: the forwarder on a QIE mainnet fork.
contract BotForwarderTest is ForkTest {
    BotForwarder internal fwd;
    ForwarderTarget internal target;
    address internal user;
    uint256 internal userPk;

    function setUp() public override {
        super.setUp();
        fwd = new BotForwarder();
        target = new ForwarderTarget(address(fwd));
        (user, userPk) = makeAddrAndKey("botfolio.user");
    }

    function test_domain() public view {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) =
            fwd.eip712Domain();
        assertEq(name, "BotFolio");
        assertEq(version, "1");
        assertEq(chainId, 1990);
        assertEq(verifying, address(fwd));
    }

    /// SPEC §0.3 measured 3,855 bytes for OZ 5.0.2's forwarder on QIE.
    function test_runtimeSizeMatchesSpec() public view {
        assertApproxEqAbs(address(fwd).code.length, 3855, 64);
    }

    function test_relayedCallSeesTheUser() public {
        _forward(fwd, userPk, address(target), abi.encodeCall(ForwarderTarget.ping, ()));
        assertEq(target.lastCaller(), user);
        assertEq(fwd.nonces(user), 1);
    }

    function test_requestCannotBeReplayed() public {
        ERC2771Forwarder.ForwardRequestData memory r =
            _request(fwd, userPk, address(target), abi.encodeCall(ForwarderTarget.ping, ()));
        fwd.execute(r);
        assertFalse(fwd.verify(r));
        vm.expectRevert();
        fwd.execute(r);
    }

    function test_expiredRequestRejected() public {
        ERC2771Forwarder.ForwardRequestData memory r =
            _request(fwd, userPk, address(target), abi.encodeCall(ForwarderTarget.ping, ()));
        vm.warp(uint256(r.deadline) + 1);
        assertFalse(fwd.verify(r));
        vm.expectRevert(
            abi.encodeWithSelector(ERC2771Forwarder.ERC2771ForwarderExpiredRequest.selector, r.deadline)
        );
        fwd.execute(r);
    }

    function test_tamperedRequestRejected() public {
        ERC2771Forwarder.ForwardRequestData memory r =
            _request(fwd, userPk, address(target), abi.encodeCall(ForwarderTarget.ping, ()));
        r.from = relayer;
        assertFalse(fwd.verify(r));
        vm.expectRevert();
        fwd.execute(r);
    }

    function test_deployScriptRunsOnFork() public {
        BotForwarder deployed = new Deploy().run();
        (, string memory name,, uint256 chainId,,,) = deployed.eip712Domain();
        assertEq(name, "BotFolio");
        assertEq(chainId, 1990);
    }
}
