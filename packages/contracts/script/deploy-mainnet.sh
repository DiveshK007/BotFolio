#!/usr/bin/env bash
# Deploys all 7 contracts to QIE mainnet (chain 1990) with Deploy.s.sol, then writes the addresses to
# deployments/1990.env (public addresses only, safe to commit) and prints what goes into Render and Vercel.
#
#   ADMIN_ADDRESS=0x… RUNNER_ADDRESS=0x… COMMITTER_ADDRESS=0x… RELAYER_ADDRESS=0x… \
#     packages/contracts/script/deploy-mainnet.sh
#
# The deployer key is never read from a file or the environment: with DEPLOYER_ACCOUNT set (a Foundry keystore,
# `cast wallet import botfolio-deployer --interactive`) forge asks for its password; without it, forge asks
# for the raw key once (`--interactive 1`). Either way it stays in this terminal. Run script/dry-run.sh first. A broadcast can't be undone (docs/deploy.md).
#
#   script/deploy-mainnet.sh --from-broadcast   only rewrites deployments/1990.env from the last broadcast
set -euo pipefail
cd "$(dirname "$0")/.."

from_broadcast=false
[ "${1:-}" = "--from-broadcast" ] && from_broadcast=true

if ! $from_broadcast; then
for name in ADMIN_ADDRESS RUNNER_ADDRESS COMMITTER_ADDRESS RELAYER_ADDRESS; do
  if [ -z "${!name:-}" ]; then
    echo "$name is not set (see docs/deploy.md step 2)" >&2
    exit 2
  fi
done

rpc="${QIE_RPC_URL:-}"
if [ -z "$rpc" ]; then
  # rpc1/rpc2 drop TLS sometimes (SPEC §0.1).
  for n in 3 4 5; do
    url="https://rpc${n}mainnet.qie.digital"
    if [ "$(cast chain-id --rpc-url "$url" 2>/dev/null || true)" = "1990" ]; then
      rpc="$url"
      break
    fi
  done
fi
if [ -z "$rpc" ] || [ "$(cast chain-id --rpc-url "$rpc")" != "1990" ]; then
  echo "no QIE mainnet RPC (chain 1990) answered" >&2
  exit 1
fi

echo "START_CASH_E8=${START_CASH_E8:-107800000000 (default)}"
echo "admin=$ADMIN_ADDRESS runner=$RUNNER_ADDRESS committer=$COMMITTER_ADDRESS relayer=$RELAYER_ADDRESS"
echo "rpc=$rpc"
read -r -p "Broadcast to QIE MAINNET? This can't be undone. Type 'deploy': " answer
[ "$answer" = "deploy" ] || { echo "stopped"; exit 1; }

if [ -n "${DEPLOYER_ACCOUNT:-}" ]; then
  signer=(--account "$DEPLOYER_ACCOUNT" --sender "$(cast wallet address --account "$DEPLOYER_ACCOUNT")")
else
  signer=(--interactive 1)
fi
forge script script/Deploy.s.sol --rpc-url "$rpc" --broadcast --slow "${signer[@]}"
fi

run="broadcast/Deploy.s.sol/1990/run-latest.json"
addr() {
  jq -r --arg c "$1" '[.transactions[] | select(.transactionType == "CREATE" and .contractName == $c)][0].contractAddress' "$run"
}
# The first receipt is the forwarder's: the indexer starts there.
block=$(jq -r '.receipts[0].blockNumber' "$run")
case "$block" in 0x*) block=$(cast to-dec "$block") ;; esac

mkdir -p deployments
{
  echo "# QIE mainnet (chain 1990) — written by script/deploy-mainnet.sh on $(date -u +%Y-%m-%dT%H:%MZ). Public addresses only."
  echo "FORWARDER_ADDRESS=$(addr BotForwarder)"
  echo "PAPER_LEDGER_ADDRESS=$(addr PaperLedger)"
  echo "BOT_REGISTRY_ADDRESS=$(addr BotRegistry)"
  echo "SEASON_LEDGER_ADDRESS=$(addr SeasonLedger)"
  echo "TRUST_REGISTRY_ADDRESS=$(addr TrustScoreRegistry)"
  echo "DAILY_CALL_ADDRESS=$(addr DailyCall)"
  echo "CHALLENGES_ADDRESS=$(addr Challenges)"
  echo "INDEXER_START_BLOCK=$block"
} > deployments/1990.env

if grep -q "=null" deployments/1990.env; then
  echo "could not read every address from $run; check it by hand" >&2
  exit 1
fi

echo
echo "== deployments/1990.env (commit it, with $run)"
cat deployments/1990.env
echo
echo "== Vercel (web) — same addresses with NEXT_PUBLIC_:"
grep _ADDRESS= deployments/1990.env | sed 's/^/NEXT_PUBLIC_/'
echo
echo "Next: script/verify-mainnet.sh, then docs/deploy.md step 5 (roles check, rules, S0, house bots)."
