// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IPaperLedger} from "../src/interfaces/IPaperLedger.sol";
import {UserActions} from "./utils/UserActions.sol";

/// Issue #24: the numbers in docs/gas.md, and a guard that every relayed call fits SPEC §11's 300k cap.
///
/// Two things make the numbers real:
///   - isolation runs every top-level call as its own tx, so storage is cold, as on mainnet;
///   - the feeds are the real bytecode, not mocks (a mock is almost free). Only each feed's stored
///     `updatedAt` is overwritten, so the run doesn't depend on how fresh the live round is.
///
/// Regenerate: forge test --fork-url qie --match-contract GasLimits --isolate -vv | grep "GAS |"
/// forge-config: default.isolate = true
contract GasLimitsForkTest is UserActions {
    string internal constant URI =
        "https://example.supabase.co/storage/v1/object/public/replay/season-000.jsonl";

    function setUp() public override {
        super.setUp();
        _useRealFeeds();
        _freshenRealFeeds();
    }

    /// Each feed keeps `updatedAt` in a plain storage slot (seen on all 5, Nov 22 2026), so find the
    /// slots `latestRoundData` reads that hold that value and set them to now.
    function _freshenRealFeeds() internal {
        for (uint8 a; a < 5; ++a) {
            vm.record();
            (,,, uint256 updatedAt,) = IAggregatorV3(FEEDS[a]).latestRoundData();
            (bytes32[] memory reads,) = vm.accesses(FEEDS[a]);
            for (uint256 i; i < reads.length; ++i) {
                if (uint256(vm.load(FEEDS[a], reads[i])) == updatedAt) {
                    vm.store(FEEDS[a], reads[i], bytes32(block.timestamp));
                }
            }
            (,,, uint256 nowAt,) = IAggregatorV3(FEEDS[a]).latestRoundData();
            assertEq(nowAt, block.timestamp, "feed storage layout changed: can't freshen it");
        }
    }

    // --- the 8 relayed calls

    function test_gas_createBot() public {
        _relayed("createBot", address(d.registry), _createBotData());
    }

    function test_gas_setActive() public {
        uint256 bot = _createBotAs(user);
        _relayed("setActive", address(d.registry), _setActiveData(bot));
    }

    function test_gas_commitVersion() public {
        uint256 bot = _createBotAs(user);
        _relayed("commitVersion", address(d.seasonLedger), _commitData(bot));
    }

    function test_gas_recordCorrection() public {
        uint256 bot = _createBotAs(user);
        _relayed("recordCorrection", address(d.seasonLedger), _correctionData(bot));
    }

    function test_gas_executeApproved_emptyPortfolio() public {
        uint256 bot = _createBotAs(user);
        _relayed("executeApproved: empty portfolio", address(d.paperLedger), _approveData(bot, ETH, 3500));
    }

    /// The 5-feed cap check.
    function test_gas_executeApproved_fiveHoldings() public {
        uint256 bot = _createBotAs(user);
        _hold(bot, 5);
        _relayed(
            "executeApproved: holds all 5 (5-feed cap check)",
            address(d.paperLedger),
            _approveData(bot, ETH, 1000)
        );
    }

    /// Four feeds in the cap check, and a new storage slot for the fifth asset.
    function test_gas_executeApproved_fourHoldingsNewAsset() public {
        uint256 bot = _createBotAs(user);
        _hold(bot, 4);
        _relayed(
            "executeApproved: holds 4, buys the 5th", address(d.paperLedger), _approveData(bot, GOLD, 1000)
        );
    }

    function test_gas_dailyCall() public {
        uint256 bot = _createBotAs(user);
        _relayed("DailyCall.call", address(d.dailyCall), _dailyData(bot));
    }

    function test_gas_challengeCreate() public {
        uint256 bot = _createBotAs(user);
        _relayed("Challenges.create", address(d.challenges), _challengeData(bot));
    }

    function test_gas_challengeAccept() public {
        uint256 friendBot = _createBotAs(friend);
        uint256 bot = _createBotAs(user);
        vm.prank(friend);
        bytes32 code = d.challenges.create(friendBot, 0);
        _relayed("Challenges.accept", address(d.challenges), _acceptData(code, bot));
    }

    // --- system calls

    function test_gas_batch_firstTrade() public {
        _batch("executeBatch: 1 order, empty portfolio", 1, 0);
    }

    function test_gas_batch_1worst() public {
        _batch("executeBatch: 1 order, 5 holdings", 1, 5);
    }

    function test_gas_batch_10() public {
        _batch("executeBatch: 10 bots, empty portfolios", 10, 0);
    }

    function test_gas_batch_10worst() public {
        _batch("executeBatch: 10 bots, 5 holdings each", 10, 5);
    }

    function test_gas_batch_50worst() public {
        _batch("executeBatch: 50 bots, 5 holdings each", 50, 5);
    }

    function test_gas_batch_staleSkip() public {
        uint256 bot = _createBotAs(user);
        IPaperLedger.Order[] memory batch = new IPaperLedger.Order[](1);
        batch[0] = IPaperLedger.Order(bot, BTC, true, 1000, "stale", 0);
        vm.warp(block.timestamp + 1801);
        vm.prank(cfg.runner);
        d.paperLedger.executeBatch(batch);
        _record("executeBatch: 1 order, skipped as stale");
    }

    function test_gas_houseBot() public {
        vm.prank(cfg.admin);
        d.registry.createHouseBot("house", 2000, 8);
        _record("createHouseBot (includes initPortfolio)");
    }

    function test_gas_adminBan() public {
        uint256 bot = _createBotAs(user);
        vm.prank(cfg.admin);
        d.registry.setActive(bot, false);
        _record("setActive: admin ban");
    }

    function test_gas_openSeason() public {
        _closeS0(); // S1 needs S0 closed
        vm.prank(cfg.committer);
        d.seasonLedger.openSeason(1, uint64(block.timestamp), uint64(block.timestamp + 2 days));
        _record("openSeason");
    }

    function test_gas_closeSeason() public {
        _warpToS0End();
        vm.prank(cfg.committer);
        d.seasonLedger.closeSeason(0, keccak256("root"), URI);
        _record("closeSeason: 76-char URI");
    }

    function test_gas_publishRules() public {
        vm.prank(cfg.admin);
        d.trust.publishRules("trust-v1-sprint", URI, keccak256("doc"));
        _record("publishRules: 76-char URI");
    }

    function test_gas_commitScores() public {
        vm.prank(cfg.admin);
        d.trust.publishRules("trust-v1-sprint", URI, keccak256("doc"));
        vm.prank(cfg.committer);
        d.trust.commitScores(0, "trust-v1-sprint", keccak256("root"), URI);
        _record("commitScores: first for a season");
    }

    function test_gas_dailySettle_1() public {
        _dailySettle("DailyCall.settle: 1 bot", 1);
    }

    function test_gas_dailySettle_10() public {
        _dailySettle("DailyCall.settle: 10 bots", 10);
    }

    function test_gas_challengeSettle() public {
        uint256 bot = _createBotAs(user);
        uint256 friendBot = _createBotAs(friend);
        vm.prank(user);
        bytes32 code = d.challenges.create(bot, 0);
        vm.prank(friend);
        d.challenges.accept(code, friendBot);
        _closeS0();
        vm.prank(cfg.committer);
        d.challenges.settle(code, bot);
        _record("Challenges.settle");
    }

    function test_gas_challengeExpire() public {
        uint256 bot = _createBotAs(user);
        vm.prank(user);
        bytes32 code = d.challenges.create(bot, 0);
        _closeS0();
        vm.prank(cfg.committer);
        d.challenges.expire(code);
        _record("Challenges.expire");
    }

    // --- helpers

    /// Finds the smallest `gas` field the user could sign for this call to succeed, then runs it once.
    function _relayed(string memory name, address target, bytes memory data) internal {
        uint256 low = 1;
        uint256 high = RELAY_GAS;
        assertTrue(_succeedsWith(high, target, data), string.concat(name, " doesn't fit in 300k"));
        while (high - low > 50) {
            uint256 mid = (low + high) / 2;
            if (_succeedsWith(mid, target, data)) high = mid;
            else low = mid;
        }

        ERC2771Forwarder.ForwardRequestData memory r = _request(d.forwarder, userPk, target, data);
        vm.prank(relayer);
        d.forwarder.execute(r);
        uint256 txGas = vm.lastCallGas().gasTotalUsed;

        emit log_string(string.concat(
                "GAS | relay | ", name, " | ", vm.toString(high), " | ", vm.toString(txGas)
            ));
    }

    function _succeedsWith(uint256 gasField, address target, bytes memory data) internal returns (bool ok) {
        uint256 snapshot = vm.snapshotState();
        ERC2771Forwarder.ForwardRequestData memory r =
            _requestWithGas(d.forwarder, userPk, target, data, gasField);
        vm.prank(relayer);
        (ok,) = address(d.forwarder).call(abi.encodeCall(ERC2771Forwarder.execute, (r)));
        vm.revertToState(snapshot);
    }

    /// Logs the gas of the tx that has just run.
    function _warpToS0End() internal {
        (, uint64 end,,,) = d.seasonLedger.seasons(0);
        vm.warp(end);
    }

    function _closeS0() internal {
        _warpToS0End();
        vm.prank(cfg.committer);
        d.seasonLedger.closeSeason(0, keccak256("root"), URI);
    }

    function _record(string memory name) internal {
        uint256 used = vm.lastCallGas().gasTotalUsed;
        emit log_string(string.concat("GAS | system | ", name, " | ", vm.toString(used)));
    }

    function _hold(uint256 bot, uint8 assets) internal {
        IPaperLedger.Order[] memory batch = new IPaperLedger.Order[](assets);
        for (uint8 a; a < assets; ++a) {
            batch[a] = IPaperLedger.Order(bot, a, true, 1000, keccak256(abi.encode(bot, "seed")), a);
        }
        vm.prank(cfg.runner);
        d.paperLedger.executeBatch(batch);
        for (uint8 a; a < assets; ++a) {
            assertGt(d.paperLedger.unitsE18(bot, a), 0, "seed trade didn't execute");
        }
    }

    function _bots(uint256 n) internal returns (uint256[] memory ids) {
        ids = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            ids[i] = _createBotAs(address(uint160(0xB0700000 + i)));
        }
    }

    function _batch(string memory name, uint256 n, uint8 holdingsEach) internal {
        uint256[] memory ids = _bots(n);
        IPaperLedger.Order[] memory batch = new IPaperLedger.Order[](n);
        for (uint256 i; i < n; ++i) {
            if (holdingsEach != 0) _hold(ids[i], holdingsEach);
            batch[i] = IPaperLedger.Order(ids[i], ETH, true, 1000, keccak256(abi.encode(ids[i], "slot")), 0);
        }
        vm.prank(cfg.runner);
        d.paperLedger.executeBatch(batch);
        _record(name);
        (,, uint8 trades,) = d.paperLedger.portfolios(ids[n - 1]);
        assertEq(trades, uint256(holdingsEach) + 1, "measured order didn't execute");
    }

    function _dailySettle(string memory name, uint256 n) internal {
        uint256[] memory ids = _bots(n);
        uint32 day = d.dailyCall.today();
        for (uint256 i; i < n; ++i) {
            bytes memory sig = _sign(runnerPk, d.dailyCall.hashBotView(ids[i], day, true));
            address owner = d.registry.getBot(ids[i]).owner;
            vm.prank(owner);
            d.dailyCall.call(ids[i], true, true, sig);
        }
        vm.warp(_istTime(day, 21 hours));
        _freshenRealFeeds();
        vm.prank(cfg.committer);
        d.dailyCall.settle(ids, day);
        _record(name);
        (,,,,, bool settled,,) = d.dailyCall.calls(ids[n - 1], day);
        assertTrue(settled, "measured settle didn't execute");
    }
}
