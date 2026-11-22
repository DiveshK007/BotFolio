#!/usr/bin/env bash
# Writes abi/<Contract>.json from the frozen interfaces (src/interfaces/I<Contract>.sol).
#
# The interfaces, not the implementations, are exported on purpose: they are what is frozen
# (SPEC §12.2), so adding internals to a contract can never move the ABI other packages import.
# The compiler checks each implementation against its interface.
#
# Run after an announced interface change. test/AbiExport.t.sol fails in CI if abi/ is out of date.
set -euo pipefail
cd "$(dirname "$0")/.."

forge build > /dev/null
for name in BotForwarder BotRegistry PaperLedger SeasonLedger TrustScoreRegistry DailyCall Challenges; do
  jq '.abi' "out/I${name}.sol/I${name}.json" > "abi/${name}.json"
  echo "abi/${name}.json"
done
