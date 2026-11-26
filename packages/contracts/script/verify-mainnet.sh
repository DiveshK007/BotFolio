#!/usr/bin/env bash
# Verifies the 7 deployed contracts on the QIE explorer (Blockscout v7, https://mainnet.qie.digital).
# Reads addresses from deployments/1990.env. Needs no key. Safe to run again: a verified contract is skipped.
#
#   packages/contracts/script/verify-mainnet.sh
set -euo pipefail
cd "$(dirname "$0")/.."

env_file=deployments/1990.env
[ -f "$env_file" ] || { echo "$env_file missing: run script/deploy-mainnet.sh first" >&2; exit 2; }
# shellcheck disable=SC1090
set -a; . "$env_file"; set +a

rpc="${QIE_RPC_URL:-https://rpc3mainnet.qie.digital}"
explorer=https://mainnet.qie.digital

verify() {
  local address=$1 target=$2
  if curl -fsS --max-time 20 "$explorer/api/v2/smart-contracts/$address" | jq -e '.is_verified == true' >/dev/null 2>&1; then
    echo "already verified: $target $address"
    return
  fi
  echo "verifying $target $address"
  # Constructor args are read back from the creation tx, so nothing here can drift from what was deployed.
  forge verify-contract "$address" "$target" \
    --chain-id 1990 --rpc-url "$rpc" --guess-constructor-args \
    --verifier blockscout --verifier-url "$explorer/api/" --watch
}

verify "$FORWARDER_ADDRESS" src/BotForwarder.sol:BotForwarder
verify "$PAPER_LEDGER_ADDRESS" src/PaperLedger.sol:PaperLedger
verify "$BOT_REGISTRY_ADDRESS" src/BotRegistry.sol:BotRegistry
verify "$SEASON_LEDGER_ADDRESS" src/SeasonLedger.sol:SeasonLedger
verify "$TRUST_REGISTRY_ADDRESS" src/TrustScoreRegistry.sol:TrustScoreRegistry
verify "$DAILY_CALL_ADDRESS" src/DailyCall.sol:DailyCall
verify "$CHALLENGES_ADDRESS" src/Challenges.sol:Challenges

echo
for name in FORWARDER PAPER_LEDGER BOT_REGISTRY SEASON_LEDGER TRUST_REGISTRY DAILY_CALL CHALLENGES; do
  var="${name}_ADDRESS"
  echo "$explorer/address/${!var}"
done
