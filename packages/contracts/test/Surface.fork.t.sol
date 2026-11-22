// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {DeployedFixture} from "./utils/DeployedFixture.sol";

/// What the deployed contracts can do, checked on the compiled code (SPEC §4.6, §0.1).
contract SurfaceForkTest is DeployedFixture {
    string[7] internal NAMES = [
        "BotForwarder",
        "PaperLedger",
        "BotRegistry",
        "SeasonLedger",
        "TrustScoreRegistry",
        "DailyCall",
        "Challenges"
    ];

    /// No hidden setters: every external function is in the frozen interface (so in abi/ too), apart
    /// from OZ's DEFAULT_ADMIN_ROLE() getter. And every frozen function exists.
    function test_externalSurfaceIsExactlyTheFrozenInterface() public view {
        for (uint256 i; i < NAMES.length; ++i) {
            string[] memory impl = _methods(NAMES[i]);
            string[] memory frozen = _methods(string.concat("I", NAMES[i]));
            for (uint256 m; m < impl.length; ++m) {
                if (keccak256(bytes(impl[m])) == keccak256("DEFAULT_ADMIN_ROLE()")) continue;
                assertTrue(_has(frozen, impl[m]), string.concat(NAMES[i], " has an extra ", impl[m]));
            }
            for (uint256 m; m < frozen.length; ++m) {
                assertTrue(_has(impl, frozen[m]), string.concat(NAMES[i], " is missing ", frozen[m]));
            }
        }
    }

    /// Feeds and max ages come from bytecode: reading them touches no storage slot, so there is nothing
    /// an admin could write to change them.
    function test_feedsAndMaxAgesLiveInBytecode() public {
        vm.record();
        for (uint8 a; a < 5; ++a) {
            d.paperLedger.feed(a);
            d.paperLedger.maxAge(a);
        }
        d.dailyCall.btcFeed();
        d.dailyCall.MAX_AGE();

        (bytes32[] memory ledgerReads,) = vm.accesses(address(d.paperLedger));
        (bytes32[] memory dailyReads,) = vm.accesses(address(d.dailyCall));
        assertEq(ledgerReads.length, 0, "PaperLedger reads storage for a feed");
        assertEq(dailyReads.length, 0, "DailyCall reads storage for a feed");
    }

    function test_feedsAreTheSpecAddresses() public view {
        for (uint8 a; a < 5; ++a) {
            assertEq(d.paperLedger.feed(a), FEEDS[a]);
            assertEq(d.paperLedger.maxAge(a), MAX_AGES[a]);
        }
        assertEq(d.dailyCall.btcFeed(), FEEDS[BTC]);
    }

    /// QIE is Shanghai. None of the Cancun opcodes may appear in deployed code.
    function test_noCancunOpcodes() public view {
        address[7] memory all = _all();
        for (uint256 i; i < all.length; ++i) {
            bytes memory code = all[i].code;
            // The last two bytes are the length of the CBOR metadata in front of them.
            uint256 metadata = (uint256(uint8(code[code.length - 2])) << 8) | uint8(code[code.length - 1]);
            uint256 end = code.length - 2 - metadata;
            for (uint256 pc; pc < end; ++pc) {
                uint8 op = uint8(code[pc]);
                // TLOAD, TSTORE, MCOPY, BLOBHASH, BLOBBASEFEE
                bool cancun = op == 0x5c || op == 0x5d || op == 0x5e || op == 0x49 || op == 0x4a;
                assertFalse(cancun, string.concat(NAMES[i], " uses a Cancun opcode"));
                if (op >= 0x60 && op <= 0x7f) pc += op - 0x5f; // skip PUSH data
            }
        }
    }

    function _methods(string memory name) private view returns (string[] memory) {
        string memory artifact = vm.readFile(string.concat("out/", name, ".sol/", name, ".json"));
        return vm.parseJsonKeys(artifact, ".methodIdentifiers");
    }

    function _has(string[] memory list, string memory item) private pure returns (bool) {
        for (uint256 i; i < list.length; ++i) {
            if (keccak256(bytes(list[i])) == keccak256(bytes(item))) return true;
        }
        return false;
    }
}
