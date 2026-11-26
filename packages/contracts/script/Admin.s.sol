// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IBotRegistry} from "../src/interfaces/IBotRegistry.sol";
import {ISeasonLedger} from "../src/interfaces/ISeasonLedger.sol";
import {ITrustScoreRegistry} from "../src/interfaces/ITrustScoreRegistry.sol";

/// Admin scripts (issue #29, README "Admin scripts"): OpenSeason, CloseSeason, PublishRules, SeedHouseBots.
///
/// None reads a private key. Pass `--sender <address>` to simulate. A real run adds the signer and
/// `--broadcast` on the command line, and is done by a person.
abstract contract AdminScript is Script {
    uint256 internal constant QIE_CHAIN_ID = 1990;
    uint256 internal constant MAX_UNIX_SECONDS = 4_102_444_800; // year 2100

    error WrongChain(uint256 chainId);
    error BadInput(string what);

    modifier onQie() {
        if (block.chainid != QIE_CHAIN_ID) revert WrongChain(block.chainid);
        _;
    }
}

/// COMMITTER_ROLE. Env: SEASON_LEDGER_ADDRESS, SEASON, SEASON_START, SEASON_END (unix seconds).
contract OpenSeason is AdminScript {
    function run() external {
        runWith(
            ISeasonLedger(vm.envAddress("SEASON_LEDGER_ADDRESS")),
            vm.envUint("SEASON"),
            vm.envUint("SEASON_START"),
            vm.envUint("SEASON_END")
        );
    }

    function runWith(ISeasonLedger ledger, uint256 n, uint256 start, uint256 end) public onQie {
        if (n > type(uint32).max) revert BadInput("SEASON is too large");
        if (start >= end) revert BadInput("SEASON_START must be before SEASON_END");
        if (end > MAX_UNIX_SECONDS) revert BadInput("times are unix seconds, not milliseconds");
        if (n != ledger.nextSeason()) revert BadInput("SEASON is not nextSeason()");

        vm.startBroadcast();
        ledger.openSeason(uint32(n), uint64(start), uint64(end));
        vm.stopBroadcast();

        console2.log("season %s open: %s -> %s", n, start, end);
    }
}

/// COMMITTER_ROLE. Env: SEASON_LEDGER_ADDRESS, SEASON, DATA_ROOT, DATA_URI.
/// The contract doesn't check the end time or the root, and a close can't be undone, so this does.
contract CloseSeason is AdminScript {
    function run() external {
        runWith(
            ISeasonLedger(vm.envAddress("SEASON_LEDGER_ADDRESS")),
            vm.envUint("SEASON"),
            vm.envBytes32("DATA_ROOT"),
            vm.envString("DATA_URI")
        );
    }

    function runWith(ISeasonLedger ledger, uint256 n, bytes32 root, string memory uri) public onQie {
        if (n > type(uint32).max) revert BadInput("SEASON is too large");
        if (root == bytes32(0)) revert BadInput("DATA_ROOT is zero");
        if (bytes(uri).length == 0) revert BadInput("DATA_URI is empty");
        if (ledger.seasonState(uint32(n)) != ISeasonLedger.SeasonState.OPEN) {
            revert BadInput("SEASON is not open");
        }
        (, uint64 end,,,) = ledger.seasons(uint32(n));
        if (block.timestamp < end) revert BadInput("SEASON has not ended yet");

        vm.startBroadcast();
        ledger.closeSeason(uint32(n), root, uri);
        vm.stopBroadcast();

        console2.log("season %s closed: %s", n, uri);
    }
}

/// DEFAULT_ADMIN_ROLE (cold key). Env: TRUST_REGISTRY_ADDRESS, RULES_VERSION, RULES_URI, RULES_DOC_HASH.
/// Run it once per version: "trust-v1-sprint", then "trust-v1" (SPEC §7).
contract PublishRules is AdminScript {
    function run() external {
        runWith(
            ITrustScoreRegistry(vm.envAddress("TRUST_REGISTRY_ADDRESS")),
            vm.envString("RULES_VERSION"),
            vm.envString("RULES_URI"),
            vm.envBytes32("RULES_DOC_HASH")
        );
    }

    /// A version can never be edited or removed, so a typo would be permanent. Only the two known
    /// versions are accepted; a future trust-v2 is a one-line change here.
    function runWith(ITrustScoreRegistry trust, string memory version, string memory uri, bytes32 docHash)
        public
        onQie
    {
        bytes32 h = keccak256(bytes(version));
        if (h != keccak256("trust-v1-sprint") && h != keccak256("trust-v1")) {
            revert BadInput("RULES_VERSION must be trust-v1-sprint or trust-v1");
        }
        if (bytes(uri).length == 0) revert BadInput("RULES_URI is empty");
        if (docHash == bytes32(0)) revert BadInput("RULES_DOC_HASH is zero");

        bytes32 id = bytes32(bytes(version)); // left-aligned, as events.md says
        if (trust.rulesDocHash(id) != bytes32(0)) revert BadInput("RULES_VERSION is already published");

        vm.startBroadcast();
        trust.publishRules(id, uri, docHash);
        vm.stopBroadcast();

        console2.log("published %s: %s", version, uri);
    }
}

/// DEFAULT_ADMIN_ROLE (cold key), issue #28. Env: BOT_REGISTRY_ADDRESS, HOUSE_HASHES, HOUSE_BPS, HOUSE_TRADES
/// (comma-separated, printed by `pnpm --filter ./apps/worker house:seed forge`, see docs/deploy.md). Creates the three house
/// bots as botIds 1-3, so it only runs on a registry with no bots yet: a second run can't make duplicates.
contract SeedHouseBots is AdminScript {
    function run() external {
        runWith(
            IBotRegistry(vm.envAddress("BOT_REGISTRY_ADDRESS")),
            vm.envBytes32("HOUSE_HASHES", ","),
            vm.envUint("HOUSE_BPS", ","),
            vm.envUint("HOUSE_TRADES", ",")
        );
    }

    function runWith(
        IBotRegistry registry,
        bytes32[] memory hashes,
        uint256[] memory bps,
        uint256[] memory trades
    ) public onQie {
        if (hashes.length != 3 || bps.length != 3 || trades.length != 3) {
            revert BadInput("need exactly 3 house bots");
        }
        if (registry.nextBotId() != 1) revert BadInput("registry already has bots");
        for (uint256 i; i < 3; ++i) {
            if (hashes[i] == bytes32(0)) revert BadInput("HOUSE_HASHES has a zero hash");
            if (bps[i] > type(uint16).max || trades[i] > type(uint8).max) revert BadInput("limit too large");
        }

        vm.startBroadcast();
        for (uint256 i; i < 3; ++i) {
            // forge-lint: disable-next-line(unsafe-typecast)
            uint256 id = registry.createHouseBot(hashes[i], uint16(bps[i]), uint8(trades[i]));
            console2.log("house bot %s created", id);
        }
        vm.stopBroadcast();
    }
}
