// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Script, console2} from "forge-std/Script.sol";
import {BotForwarder} from "../src/BotForwarder.sol";
import {BotRegistry} from "../src/BotRegistry.sol";
import {Challenges} from "../src/Challenges.sol";
import {DailyCall} from "../src/DailyCall.sol";
import {PaperLedger} from "../src/PaperLedger.sol";
import {SeasonLedger} from "../src/SeasonLedger.sol";
import {TrustScoreRegistry} from "../src/TrustScoreRegistry.sol";
import {Roles} from "../src/lib/Roles.sol";

/// Deploys and wires BotFolio's 7 contracts on QIE mainnet (chain 1990) or a local fork of it
/// (docs/anvil-fork.md). Order: Forwarder, PaperLedger, BotRegistry, SeasonLedger, TrustScoreRegistry,
/// DailyCall, Challenges.
///
/// Env (addresses only, this script never reads a private key):
///   ADMIN_ADDRESS      the cold key; gets DEFAULT_ADMIN_ROLE everywhere
///   RUNNER_ADDRESS     RUNNER_ROLE on PaperLedger and DailyCall
///   COMMITTER_ADDRESS  COMMITTER_ROLE on SeasonLedger, TrustScoreRegistry, DailyCall and Challenges
///   RELAYER_ADDRESS    gets nothing; passed so the script can prove it has no role
///   START_CASH_E8      optional; default DEFAULT_START_CASH_E8
///
/// Simulate (no key, nothing sent): forge script script/Deploy.s.sol --fork-url qie
contract Deploy is Script {
    struct Config {
        address admin;
        address runner;
        address committer;
        address relayer;
        uint256 startCashE8;
    }

    struct Deployment {
        BotForwarder forwarder;
        PaperLedger paperLedger;
        BotRegistry registry;
        SeasonLedger seasonLedger;
        TrustScoreRegistry trust;
        DailyCall dailyCall;
        Challenges challenges;
    }

    uint256 internal constant QIE_CHAIN_ID = 1990;

    /// 1,078 play USDT is about INR 1,00,000: USD/INR was 92.68 (frankfurter.dev, Nov 20 2026) and 92.89
    /// (open.er-api.com, Nov 22 2026). Recheck on deploy day. The UI shows exactly INR 1,00,000 at the
    /// start whatever this is, because the display is a ratio (SPEC §3).
    uint256 public constant DEFAULT_START_CASH_E8 = 1078e8;

    error WrongChain(uint256 chainId);
    error BadConfig(string what);
    error CheckFailed(string what);

    function run() external returns (Deployment memory) {
        return runWith(
            Config({
                admin: vm.envAddress("ADMIN_ADDRESS"),
                runner: vm.envAddress("RUNNER_ADDRESS"),
                committer: vm.envAddress("COMMITTER_ADDRESS"),
                relayer: vm.envAddress("RELAYER_ADDRESS"),
                startCashE8: vm.envOr("START_CASH_E8", DEFAULT_START_CASH_E8)
            })
        );
    }

    /// Separate from `run` so tests can pass a config without touching process-wide env vars.
    function runWith(Config memory cfg) public returns (Deployment memory d) {
        if (block.chainid != QIE_CHAIN_ID) revert WrongChain(block.chainid);

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        _checkConfig(cfg, deployer);
        d = _deploy(cfg, deployer);
        _wire(d, cfg);
        if (cfg.admin != deployer) _handOver(d, cfg.admin, deployer);
        vm.stopBroadcast();

        _check(d, cfg, deployer);
        _log(d);
    }

    /// Four different keys, and the deployer isn't one of the hot ones (SPEC §4.6, §11).
    function _checkConfig(Config memory cfg, address deployer) private pure {
        address[4] memory keys = [cfg.admin, cfg.runner, cfg.committer, cfg.relayer];
        for (uint256 i; i < keys.length; ++i) {
            if (keys[i] == address(0)) revert BadConfig("zero address");
            for (uint256 j = i + 1; j < keys.length; ++j) {
                if (keys[i] == keys[j]) revert BadConfig("admin, runner, committer and relayer must differ");
            }
            if (i > 0 && keys[i] == deployer) revert BadConfig("deployer is a hot wallet");
        }
        if (cfg.startCashE8 == 0) revert BadConfig("START_CASH_E8 is zero");
    }

    /// BotRegistry and PaperLedger each hold the other's address as an immutable, so there is no
    /// setter. CREATE addresses follow from (deployer, nonce), so the ledger can be told the registry's
    /// address one transaction before the registry exists.
    function _deploy(Config memory cfg, address deployer) private returns (Deployment memory d) {
        d.forwarder = new BotForwarder();
        address fwd = address(d.forwarder);

        address predictedRegistry = vm.computeCreateAddress(deployer, uint256(vm.getNonce(deployer)) + 1);
        d.paperLedger = new PaperLedger(fwd, deployer, predictedRegistry, cfg.startCashE8);
        d.registry = new BotRegistry(fwd, deployer, address(d.paperLedger));
        if (address(d.registry) != predictedRegistry) revert CheckFailed("registry address prediction");

        address reg = address(d.registry);
        d.seasonLedger = new SeasonLedger(fwd, deployer, reg);
        d.trust = new TrustScoreRegistry(deployer, address(d.seasonLedger));
        d.dailyCall = new DailyCall(fwd, deployer, reg);
        d.challenges = new Challenges(fwd, deployer, reg, address(d.seasonLedger));
    }

    function _wire(Deployment memory d, Config memory cfg) private {
        d.paperLedger.grantRole(Roles.REGISTRY, address(d.registry));
        d.registry.grantRole(Roles.SEASON_LEDGER, address(d.seasonLedger));

        d.paperLedger.grantRole(Roles.RUNNER, cfg.runner);
        d.dailyCall.grantRole(Roles.RUNNER, cfg.runner);

        d.seasonLedger.grantRole(Roles.COMMITTER, cfg.committer);
        d.trust.grantRole(Roles.COMMITTER, cfg.committer);
        d.dailyCall.grantRole(Roles.COMMITTER, cfg.committer);
        d.challenges.grantRole(Roles.COMMITTER, cfg.committer);
    }

    /// The deployer keeps nothing when the cold key is a different address. Grant everything first:
    /// if the script stops halfway, some admin still exists.
    function _handOver(Deployment memory d, address admin, address deployer) private {
        IAccessControl[6] memory all = _managed(d);
        for (uint256 i; i < all.length; ++i) {
            all[i].grantRole(bytes32(0), admin);
        }
        for (uint256 i; i < all.length; ++i) {
            all[i].renounceRole(bytes32(0), deployer);
        }
    }

    function _check(Deployment memory d, Config memory cfg, address deployer) private view {
        IAccessControl[6] memory all = _managed(d);
        bytes32[5] memory roles =
            [bytes32(0), Roles.RUNNER, Roles.COMMITTER, Roles.REGISTRY, Roles.SEASON_LEDGER];
        for (uint256 i; i < all.length; ++i) {
            if (!all[i].hasRole(bytes32(0), cfg.admin)) revert CheckFailed("cold key is not admin");
            if (cfg.admin != deployer && all[i].hasRole(bytes32(0), deployer)) {
                revert CheckFailed("deployer is still admin");
            }
            for (uint256 r; r < roles.length; ++r) {
                if (all[i].hasRole(roles[r], cfg.relayer)) revert CheckFailed("relayer has a role");
            }
        }

        if (d.registry.paperLedger() != address(d.paperLedger)) revert CheckFailed("registry -> ledger");
        if (d.paperLedger.registry() != address(d.registry)) revert CheckFailed("ledger -> registry");
        if (!d.paperLedger.hasRole(Roles.REGISTRY, address(d.registry))) revert CheckFailed("REGISTRY_ROLE");
        if (!d.registry.hasRole(Roles.SEASON_LEDGER, address(d.seasonLedger))) {
            revert CheckFailed("SEASON_LEDGER_ROLE");
        }
    }

    /// Every contract with roles, so all but the forwarder.
    function _managed(Deployment memory d) private pure returns (IAccessControl[6] memory) {
        return [
            IAccessControl(address(d.paperLedger)),
            IAccessControl(address(d.registry)),
            IAccessControl(address(d.seasonLedger)),
            IAccessControl(address(d.trust)),
            IAccessControl(address(d.dailyCall)),
            IAccessControl(address(d.challenges))
        ];
    }

    /// The names in .env.example, ready to paste.
    function _log(Deployment memory d) private view {
        console2.log("FORWARDER_ADDRESS=%s", address(d.forwarder));
        console2.log("BOT_REGISTRY_ADDRESS=%s", address(d.registry));
        console2.log("PAPER_LEDGER_ADDRESS=%s", address(d.paperLedger));
        console2.log("SEASON_LEDGER_ADDRESS=%s", address(d.seasonLedger));
        console2.log("TRUST_REGISTRY_ADDRESS=%s", address(d.trust));
        console2.log("DAILY_CALL_ADDRESS=%s", address(d.dailyCall));
        console2.log("CHALLENGES_ADDRESS=%s", address(d.challenges));
        console2.log("START_CASH_E8=%s", d.paperLedger.START_CASH_E8());
    }
}
