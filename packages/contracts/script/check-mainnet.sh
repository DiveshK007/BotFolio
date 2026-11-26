#!/usr/bin/env bash
# Issue #27: re-reads the roles and cross-contract wiring from the MINED deploy (Deploy.s.sol's own check ran
# during simulation only). Needs no key.
#
#   ADMIN_ADDRESS=0x… RUNNER_ADDRESS=0x… COMMITTER_ADDRESS=0x… RELAYER_ADDRESS=0x… DEPLOYER_ADDRESS=0x… \
#     packages/contracts/script/check-mainnet.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . deployments/1990.env; set +a
rpc="${QIE_RPC_URL:-https://rpc3mainnet.qie.digital}"
fail=0

role() { cast keccak "$1"; }
ADMIN=0x0000000000000000000000000000000000000000000000000000000000000000
RUNNER=$(role RUNNER_ROLE); COMMITTER=$(role COMMITTER_ROLE)
REGISTRY=$(role REGISTRY_ROLE); SEASON=$(role SEASON_LEDGER_ROLE)

has() { cast call "$1" "hasRole(bytes32,address)(bool)" "$2" "$3" --rpc-url "$rpc"; }
expect() { # contract-name address role role-name who who-name want
  local got; got=$(has "$2" "$3" "$5")
  if [ "$got" = "$7" ]; then echo "ok   $1 $4 $6=$got"; else echo "FAIL $1 $4 $6: got $got, want $7"; fail=1; fi
}

for c in PAPER_LEDGER BOT_REGISTRY SEASON_LEDGER TRUST_REGISTRY DAILY_CALL CHALLENGES; do
  a="${c}_ADDRESS"; a="${!a}"
  expect "$c" "$a" "$ADMIN" admin "$ADMIN_ADDRESS" cold-key true
  [ -n "${DEPLOYER_ADDRESS:-}" ] && [ "$DEPLOYER_ADDRESS" != "$ADMIN_ADDRESS" ] && expect "$c" "$a" "$ADMIN" admin "$DEPLOYER_ADDRESS" deployer false
  for r in "$ADMIN" "$RUNNER" "$COMMITTER" "$REGISTRY" "$SEASON"; do
    got=$(has "$a" "$r" "$RELAYER_ADDRESS")
    [ "$got" = "false" ] || { echo "FAIL $c: relayer holds role $r"; fail=1; }
  done
done
expect PaperLedger "$PAPER_LEDGER_ADDRESS" "$RUNNER" RUNNER "$RUNNER_ADDRESS" runner true
expect DailyCall "$DAILY_CALL_ADDRESS" "$RUNNER" RUNNER "$RUNNER_ADDRESS" runner true
for c in SEASON_LEDGER TRUST_REGISTRY DAILY_CALL CHALLENGES; do
  a="${c}_ADDRESS"; expect "$c" "${!a}" "$COMMITTER" COMMITTER "$COMMITTER_ADDRESS" committer true
done
expect PaperLedger "$PAPER_LEDGER_ADDRESS" "$REGISTRY" REGISTRY "$BOT_REGISTRY_ADDRESS" BotRegistry true
expect BotRegistry "$BOT_REGISTRY_ADDRESS" "$SEASON" SEASON_LEDGER "$SEASON_LEDGER_ADDRESS" SeasonLedger true

same() { [ "$(echo "$2" | tr A-F a-f)" = "$(echo "$3" | tr A-F a-f)" ] && echo "ok   $1" || { echo "FAIL $1: $2 != $3"; fail=1; }; }
same "registry -> ledger" "$(cast call "$BOT_REGISTRY_ADDRESS" "paperLedger()(address)" --rpc-url "$rpc")" "$PAPER_LEDGER_ADDRESS"
same "ledger -> registry" "$(cast call "$PAPER_LEDGER_ADDRESS" "registry()(address)" --rpc-url "$rpc")" "$BOT_REGISTRY_ADDRESS"
same "trust -> season ledger" "$(cast call "$TRUST_REGISTRY_ADDRESS" "seasonLedger()(address)" --rpc-url "$rpc")" "$SEASON_LEDGER_ADDRESS"
for c in BOT_REGISTRY PAPER_LEDGER SEASON_LEDGER DAILY_CALL CHALLENGES; do
  a="${c}_ADDRESS"; same "$c forwarder" "$(cast call "${!a}" "trustedForwarder()(address)" --rpc-url "$rpc")" "$FORWARDER_ADDRESS"
done
echo "START_CASH_E8=$(cast call "$PAPER_LEDGER_ADDRESS" "START_CASH_E8()(uint256)" --rpc-url "$rpc")"
exit $fail
