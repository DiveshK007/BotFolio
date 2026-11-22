// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

/// Issue #6: abi/*.json is a frozen interface (SPEC §12.2). `forge test` compiles the interfaces first,
/// so out/ always holds freshly generated ABIs here. CI fails if a committed file differs from them.
/// Fix a failure with `script/export-abi.sh`, in an announced interface PR.
contract AbiExportTest is Test {
    function test_abi_BotForwarder() public view {
        _assertUpToDate("BotForwarder");
    }

    function test_abi_BotRegistry() public view {
        _assertUpToDate("BotRegistry");
    }

    function test_abi_PaperLedger() public view {
        _assertUpToDate("PaperLedger");
    }

    function test_abi_SeasonLedger() public view {
        _assertUpToDate("SeasonLedger");
    }

    function test_abi_TrustScoreRegistry() public view {
        _assertUpToDate("TrustScoreRegistry");
    }

    function test_abi_DailyCall() public view {
        _assertUpToDate("DailyCall");
    }

    function test_abi_Challenges() public view {
        _assertUpToDate("Challenges");
    }

    /// The artifact is compact JSON that starts {"abi":[...],"bytecode"; the committed file is the same
    /// array pretty-printed. With whitespace removed from both, the file must be that whole array.
    function _assertUpToDate(string memory name) private view {
        string memory committed = vm.readFile(string.concat("abi/", name, ".json"));
        string memory built = vm.readFile(string.concat("out/I", name, ".sol/I", name, ".json"));
        string memory expected = string.concat('{"abi":', _noSpace(committed), ',"bytecode"');
        assertTrue(
            vm.contains(_noSpace(built), expected),
            string.concat("abi/", name, ".json is out of date: run script/export-abi.sh")
        );
    }

    function _noSpace(string memory s) private pure returns (string memory) {
        return vm.replace(vm.replace(s, "\n", ""), " ", "");
    }
}
