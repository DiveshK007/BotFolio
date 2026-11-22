// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BotForwarder} from "../../src/BotForwarder.sol";
import {BotRegistry} from "../../src/BotRegistry.sol";
import {PaperLedger} from "../../src/PaperLedger.sol";
import {IPaperLedger} from "../../src/interfaces/IPaperLedger.sol";
import {Roles} from "../../src/lib/Roles.sol";
import {ForkTest} from "./ForkTest.sol";

/// A forwarder, the real BotRegistry and the real PaperLedger on the fork, with one bot for Alice.
abstract contract LedgerFixture is ForkTest {
    uint256 internal constant START_CASH = 1125e8;

    BotForwarder internal fwd;
    BotRegistry internal reg;
    PaperLedger internal ledger;

    address internal admin = makeAddr("botfolio.admin");
    address internal runner;
    uint256 internal runnerPk;
    address internal alice;
    uint256 internal alicePk;
    address internal bob;
    uint256 internal bobPk;

    /// Alice's bot: 50 % per coin, 8 trades a day, the widest limits allowed.
    uint256 internal aliceBot;

    function setUp() public virtual override {
        super.setUp();
        (runner, runnerPk) = makeAddrAndKey("botfolio.runner");
        (alice, alicePk) = makeAddrAndKey("botfolio.alice");
        (bob, bobPk) = makeAddrAndKey("botfolio.bob");

        fwd = new BotForwarder();
        address predictedLedger =
            vm.computeCreateAddress(address(this), uint256(vm.getNonce(address(this))) + 1);
        reg = new BotRegistry(address(fwd), admin, predictedLedger);
        ledger = new PaperLedger(address(fwd), admin, address(reg), START_CASH);
        assertEq(address(ledger), predictedLedger);

        vm.startPrank(admin);
        ledger.grantRole(Roles.REGISTRY, address(reg));
        ledger.grantRole(Roles.RUNNER, runner);
        vm.stopPrank();

        aliceBot = _createBot(alice, 5000, 8);
    }

    function _createBot(address owner, uint16 bps, uint8 trades) internal returns (uint256) {
        vm.prank(owner);
        return reg.createBot(keccak256("persona"), bps, trades);
    }

    function _buy(uint256 bot, uint8 asset, uint16 bps, bytes32 id)
        internal
        pure
        returns (IPaperLedger.Order memory)
    {
        return IPaperLedger.Order(bot, asset, true, bps, id, 0);
    }

    function _sell(uint256 bot, uint8 asset, uint16 bps, bytes32 id)
        internal
        pure
        returns (IPaperLedger.Order memory)
    {
        return IPaperLedger.Order(bot, asset, false, bps, id, 0);
    }

    function _run(IPaperLedger.Order memory o) internal {
        IPaperLedger.Order[] memory batch = new IPaperLedger.Order[](1);
        batch[0] = o;
        _runBatch(batch);
    }

    function _runBatch(IPaperLedger.Order[] memory batch) internal {
        vm.prank(runner);
        ledger.executeBatch(batch);
    }

    function _expectSkip(IPaperLedger.Order memory o, IPaperLedger.SkipReason reason) internal {
        vm.expectEmit(address(ledger));
        emit IPaperLedger.OrderSkipped(o.botId, o.asset, o.decisionId, o.actionIndex, uint8(reason));
    }

    function _cash(uint256 bot) internal view returns (uint256 cash) {
        (cash,,,) = _portfolio(bot);
    }

    function _tradesToday(uint256 bot) internal view returns (uint8 trades) {
        (,, trades,) = _portfolio(bot);
    }

    function _portfolio(uint256 bot) internal view returns (uint256, uint16, uint8, bool) {
        (uint128 cash, uint16 day, uint8 trades, bool init) = ledger.portfolios(bot);
        return (cash, day, trades, init);
    }

    function _price(uint8 asset) internal view returns (uint256) {
        return uint256(realPrice[asset]);
    }
}
