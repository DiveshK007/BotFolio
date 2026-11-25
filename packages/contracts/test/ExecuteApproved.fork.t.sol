// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IPaperLedger} from "../src/interfaces/IPaperLedger.sol";
import {LedgerFixture} from "./utils/LedgerFixture.sol";

/// Issues #11 and #21: executeApproved, and no double execution with the runner's clipped fallback.
contract ExecuteApprovedForkTest is LedgerFixture {
    bytes32 internal constant TYPEHASH = keccak256(
        "ApprovedOrder(uint256 botId,uint8 asset,bool buy,uint16 bps,bytes32 decisionId,uint8 actionIndex,uint64 deadline)"
    );
    bytes32 internal constant DECISION = keccak256("decision");

    function _bigMove() internal view returns (IPaperLedger.ApprovedOrder memory) {
        return IPaperLedger.ApprovedOrder({
            botId: aliceBot,
            asset: ETH,
            buy: true,
            bps: 3500,
            decisionId: DECISION,
            actionIndex: 2,
            deadline: uint64(block.timestamp + 2 hours)
        });
    }

    /// The digest built by hand, as the worker does it off-chain.
    function _digest(IPaperLedger.ApprovedOrder memory o, bytes32 domain) internal pure returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(TYPEHASH, o.botId, o.asset, o.buy, o.bps, o.decisionId, o.actionIndex, o.deadline)
        );
        return MessageHashUtils.toTypedDataHash(domain, structHash);
    }

    function _runnerSig(IPaperLedger.ApprovedOrder memory o) internal view returns (bytes memory) {
        return _sign(runnerPk, _digest(o, _domain("BotFolio PaperLedger", address(ledger))));
    }

    function _approve(IPaperLedger.ApprovedOrder memory o) internal {
        bytes memory data = abi.encodeCall(IPaperLedger.executeApproved, (o, _runnerSig(o)));
        _forward(fwd, alicePk, address(ledger), data);
    }

    function _expectApproveRevert(IPaperLedger.ApprovedOrder memory o, bytes memory sig, bytes memory err)
        internal
    {
        vm.expectRevert(err);
        vm.prank(alice);
        ledger.executeApproved(o, sig);
    }

    function _rejected(IPaperLedger.SkipReason reason) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IPaperLedger.OrderRejected.selector, uint8(reason));
    }

    /// The clipped fallback the runner would send for the same action (SPEC §6.4 step 10).
    function _clipped(IPaperLedger.ApprovedOrder memory o) internal pure returns (IPaperLedger.Order memory) {
        return IPaperLedger.Order(o.botId, o.asset, o.buy, 2900, o.decisionId, o.actionIndex);
    }

    // --- EIP-712

    function test_domain() public view {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) =
            ledger.eip712Domain();
        assertEq(name, "BotFolio PaperLedger");
        assertEq(version, "1");
        assertEq(chainId, 1990);
        assertEq(verifying, address(ledger));
    }

    function test_digestMatchesAnOffChainSigner() public view {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        assertEq(ledger.APPROVED_ORDER_TYPEHASH(), TYPEHASH);
        assertEq(ledger.hashApprovedOrder(o), _digest(o, _domain("BotFolio PaperLedger", address(ledger))));
    }

    // --- the happy path

    function test_ownerApprovalIsTheTrade() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        uint256 spend = START_CASH * 3500 / 10_000;

        vm.expectEmit(address(ledger));
        emit IPaperLedger.Trade(
            aliceBot,
            ETH,
            true,
            spend,
            spend * 1e18 / _price(ETH),
            _price(ETH),
            realRound[ETH],
            block.timestamp,
            DECISION,
            2
        );
        vm.expectEmit(address(ledger));
        emit IPaperLedger.ApprovedTrade(aliceBot, DECISION, 2, alice);
        _approve(o);

        assertEq(_cash(aliceBot), START_CASH - spend);
        assertEq(_tradesToday(aliceBot), 1);
        assertTrue(ledger.usedOrder(ledger.orderIdOf(DECISION, 2)));
    }

    function test_approvedSell() public {
        _run(_buy(aliceBot, BTC, 4000, "seed"));
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        o.asset = BTC;
        o.buy = false;
        o.bps = 10_000;
        _approve(o);
        assertEq(ledger.unitsE18(aliceBot, BTC), 0);
    }

    /// On the real, unmocked feed: exactly 30 minutes old trades, one second more reverts.
    function test_realFeedStalenessBoundary() public {
        _useRealFeeds();
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(FEEDS[ETH]).latestRoundData();

        vm.warp(updatedAt + 1801);
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        _expectApproveRevert(o, _runnerSig(o), abi.encodeWithSelector(IPaperLedger.PriceTooOld.selector, ETH));

        vm.warp(updatedAt + 1800);
        o = _bigMove();
        _approve(o);
        uint256 spend = START_CASH * 3500 / 10_000;
        assertEq(ledger.unitsE18(aliceBot, ETH), spend * 1e18 / uint256(answer));
    }

    // --- who may call

    function test_onlyOwner() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        bytes memory sig = _runnerSig(o);
        address[4] memory callers = [bob, runner, admin, relayer];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(IPaperLedger.NotBotOwner.selector, aliceBot, callers[i]));
            vm.prank(callers[i]);
            ledger.executeApproved(o, sig);
        }
    }

    function test_strangerThroughForwarderFails() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        bytes memory data = abi.encodeCall(IPaperLedger.executeApproved, (o, _runnerSig(o)));
        _expectForwardFails(bobPk, data);
    }

    function _expectForwardFails(uint256 pk, bytes memory data) internal {
        bytes memory call_ =
            abi.encodeWithSelector(fwd.execute.selector, _request(fwd, pk, address(ledger), data));
        vm.prank(relayer);
        (bool ok,) = address(fwd).call(call_);
        assertFalse(ok);
        assertEq(_tradesToday(aliceBot), 0);
    }

    // --- signature

    function test_signatureFromNonRunner() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        bytes memory sig = _sign(alicePk, ledger.hashApprovedOrder(o));
        _expectApproveRevert(
            o, sig, abi.encodeWithSelector(IPaperLedger.InvalidRunnerSignature.selector, alice)
        );
    }

    function test_malformedSignature() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        bytes memory err = abi.encodeWithSelector(IPaperLedger.InvalidRunnerSignature.selector, address(0));
        _expectApproveRevert(o, "", err);
        _expectApproveRevert(o, hex"1234", err);
        _expectApproveRevert(o, new bytes(65), err);
    }

    /// The runner signs the whole struct, so changing any one field breaks the signature.
    function test_everyFieldIsSigned() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        bytes memory sig = _runnerSig(o);
        uint256 secondBot = reg.nextBotId();
        vm.prank(admin);
        reg.createHouseBot("house", 5000, 8);

        o.asset = BTC;
        _expectBadSig(o, sig, alice);
        o = _bigMove();
        o.buy = false;
        _expectBadSig(o, sig, alice);
        o = _bigMove();
        o.bps += 1;
        _expectBadSig(o, sig, alice);
        o = _bigMove();
        o.decisionId = "other";
        _expectBadSig(o, sig, alice);
        o = _bigMove();
        o.actionIndex = 1;
        _expectBadSig(o, sig, alice);
        o = _bigMove();
        o.deadline += 1;
        _expectBadSig(o, sig, alice);
        o = _bigMove();
        o.botId = secondBot;
        _expectBadSig(o, sig, admin);
    }

    function _expectBadSig(IPaperLedger.ApprovedOrder memory o, bytes memory sig, address caller) internal {
        vm.expectPartialRevert(IPaperLedger.InvalidRunnerSignature.selector);
        vm.prank(caller);
        ledger.executeApproved(o, sig);
    }

    function test_signatureForAnotherDomain() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        _expectBadSig(o, _sign(runnerPk, _digest(o, _domain("BotFolio", address(ledger)))), alice);
        _expectBadSig(o, _sign(runnerPk, _digest(o, _domain("BotFolio PaperLedger", address(reg)))), alice);
    }

    function test_revokedRunnerSignatureStopsWorking() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        bytes memory sig = _runnerSig(o);
        bytes32 role = ledger.RUNNER_ROLE();
        vm.prank(admin);
        ledger.revokeRole(role, runner);
        _expectBadSig(o, sig, alice);
    }

    // --- deadline

    function test_deadlineItselfIsStillValid() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        vm.warp(o.deadline);
        _freshAll();
        _approve(o);
        assertEq(_tradesToday(aliceBot), 1);
    }

    function test_expiredDeadlineReverts() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        bytes memory sig = _runnerSig(o);
        vm.warp(uint256(o.deadline) + 1);
        _freshAll();
        _expectApproveRevert(
            o, sig, abi.encodeWithSelector(IPaperLedger.ApprovalExpired.selector, o.deadline)
        );
    }

    // --- the batch checks, as reverts

    function test_stalePriceReverts_thenRetryWorks() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        _setAge(ETH, 1801);
        _expectApproveRevert(o, _runnerSig(o), abi.encodeWithSelector(IPaperLedger.PriceTooOld.selector, ETH));
        _freshAll();
        _approve(o);
        assertEq(_tradesToday(aliceBot), 1);
    }

    function test_staleGoldUsesSixHours() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        o.asset = GOLD;
        _setAge(GOLD, 21_601);
        _expectApproveRevert(
            o, _runnerSig(o), abi.encodeWithSelector(IPaperLedger.PriceTooOld.selector, GOLD)
        );
        _setAge(GOLD, 21_600);
        _approve(o);
        assertEq(_tradesToday(aliceBot), 1);
    }

    /// #151: a zero answer or a reverting feed is "price too old" as well, so the app says "try again",
    /// and the orderId stays unused for that retry.
    function test_unusableFeedRevertsAsTooOld() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        bytes memory tooOld = abi.encodeWithSelector(IPaperLedger.PriceTooOld.selector, ETH);
        _setPrice(ETH, 0, block.timestamp);
        _expectApproveRevert(o, _runnerSig(o), tooOld);
        vm.mockCallRevert(FEEDS[ETH], abi.encodeCall(IAggregatorV3.latestRoundData, ()), "down");
        _expectApproveRevert(o, _runnerSig(o), tooOld);
        assertFalse(ledger.usedOrder(ledger.orderIdOf(o.decisionId, o.actionIndex)));
    }

    function test_overCapReverts() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        o.bps = 5001;
        _expectApproveRevert(o, _runnerSig(o), _rejected(IPaperLedger.SkipReason.LIMIT));
    }

    function test_inactiveBotReverts() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        bytes memory sig = _runnerSig(o);
        vm.prank(admin);
        reg.setActive(aliceBot, false);
        _expectApproveRevert(o, sig, _rejected(IPaperLedger.SkipReason.INACTIVE));
    }

    function test_unknownAssetReverts() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        o.asset = 5;
        _expectApproveRevert(o, _runnerSig(o), _rejected(IPaperLedger.SkipReason.INACTIVE));
    }

    function test_zeroReverts() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        o.bps = 0;
        _expectApproveRevert(o, _runnerSig(o), _rejected(IPaperLedger.SkipReason.ZERO));
    }

    function test_countsTowardTradesToday() public {
        for (uint256 i; i < 8; ++i) {
            _run(_buy(aliceBot, BTC, 100, bytes32(i)));
        }
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        _expectApproveRevert(o, _runnerSig(o), _rejected(IPaperLedger.SkipReason.LIMIT));
    }

    // --- no double execution (#21)

    function test_replayOfApprovalReverts() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        _approve(o);
        _expectApproveRevert(o, _runnerSig(o), _rejected(IPaperLedger.SkipReason.USED));
    }

    function test_approvedThenClippedIsBlocked() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        _approve(o);
        uint256 cash = _cash(aliceBot);

        IPaperLedger.Order memory fallback_ = _clipped(o);
        _expectSkip(fallback_, IPaperLedger.SkipReason.USED);
        _run(fallback_);
        assertEq(_cash(aliceBot), cash);
        assertEq(_tradesToday(aliceBot), 1);
    }

    function test_clippedThenApprovedIsBlocked() public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        _run(_clipped(o));
        uint256 cash = _cash(aliceBot);

        _expectApproveRevert(o, _runnerSig(o), _rejected(IPaperLedger.SkipReason.USED));
        assertEq(_cash(aliceBot), cash);
        assertEq(_tradesToday(aliceBot), 1);
    }

    /// Any size and either direction: once an orderId has executed, neither path runs it again.
    function testFuzz_orderIdExecutesOnce(uint8 actionIndex, uint16 bps, bool approveFirst) public {
        IPaperLedger.ApprovedOrder memory o = _bigMove();
        o.actionIndex = actionIndex;
        o.bps = uint16(bound(bps, 100, 4000));
        IPaperLedger.Order memory batched = _clipped(o);

        if (approveFirst) _approve(o);
        else _run(batched);
        uint256 cash = _cash(aliceBot);

        _run(batched);
        _expectApproveRevert(o, _runnerSig(o), _rejected(IPaperLedger.SkipReason.USED));
        assertEq(_cash(aliceBot), cash);
        assertEq(_tradesToday(aliceBot), 1);
    }

    /// BUY BTC + SELL GOLD + big-move ETH in one decision: all three execute, each exactly once.
    function test_threeActionDecisionExecutesEachOnce() public {
        _run(_buy(aliceBot, GOLD, 2000, "earlier gold"));

        IPaperLedger.Order[] memory batch = new IPaperLedger.Order[](2);
        batch[0] = IPaperLedger.Order(aliceBot, BTC, true, 2000, DECISION, 0);
        batch[1] = IPaperLedger.Order(aliceBot, GOLD, false, 5000, DECISION, 1);
        _runBatch(batch);
        IPaperLedger.ApprovedOrder memory eth = _bigMove();
        _approve(eth);

        uint256 btcUnits = ledger.unitsE18(aliceBot, BTC);
        uint256 goldUnits = ledger.unitsE18(aliceBot, GOLD);
        uint256 ethUnits = ledger.unitsE18(aliceBot, ETH);
        assertGt(btcUnits, 0);
        assertGt(goldUnits, 0);
        assertGt(ethUnits, 0);
        assertEq(_tradesToday(aliceBot), 4, "earlier gold + 3 actions");

        // Replay all three, down every path.
        _runBatch(batch);
        _run(_clipped(eth));
        _expectApproveRevert(eth, _runnerSig(eth), _rejected(IPaperLedger.SkipReason.USED));

        assertEq(ledger.unitsE18(aliceBot, BTC), btcUnits);
        assertEq(ledger.unitsE18(aliceBot, GOLD), goldUnits);
        assertEq(ledger.unitsE18(aliceBot, ETH), ethUnits);
        assertEq(_tradesToday(aliceBot), 4);
    }
}
