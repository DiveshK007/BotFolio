#!/usr/bin/env bash
# The admin (cold key) steps after the deploy, in one go (#188, #28):
#   1. publishRules for trust-v1-sprint and trust-v1, pointing at docs/trust-rules.md pinned to a main commit
#   2. the three house bots (botIds 1-3)
# S0 itself is opened by the worker on start (seasons/checks.ts), with the committer key.
#
#   ADMIN_ACCOUNT=botfolio-admin packages/contracts/script/launch-admin.sh
# ADMIN_ACCOUNT is a Foundry keystore (`cast wallet import botfolio-admin --interactive`), so forge asks for
# its password, never the raw key. Each step checks the chain first, so a rerun skips what's done.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ADMIN_ACCOUNT:?set ADMIN_ACCOUNT to your Foundry keystore name (docs/deploy.md step 2)}"
set -a; . deployments/1990.env; set +a
rpc="${QIE_RPC_URL:-https://rpc3mainnet.qie.digital}"
[ "$(cast chain-id --rpc-url "$rpc")" = "1990" ] || { echo "not QIE mainnet: $rpc" >&2; exit 1; }
admin=$(cast wallet address --account "$ADMIN_ACCOUNT")
echo "admin = $admin"

# 1. Trust rules: the doc is pinned to the commit on main, so the URL's bytes can never change under the hash.
repo=DiveshK007/BotFolio
git fetch -q origin main
commit=$(git rev-parse origin/main)
uri="https://raw.githubusercontent.com/$repo/$commit/docs/trust-rules.md"
tmp=$(mktemp)
curl -fsS "$uri" -o "$tmp"
doc_hash=$(cast keccak "0x$(xxd -p "$tmp" | tr -d '\n')")
rm -f "$tmp"
echo "rules doc: $uri"
echo "doc hash:  $doc_hash"
read -r -p "These rules are permanent once published. Is docs/trust-rules.md on main final? Type 'publish': " ok
[ "$ok" = "publish" ] || { echo "stopped"; exit 1; }

for version in trust-v1-sprint trust-v1; do
  id=$(cast --format-bytes32-string "$version")
  if [ "$(cast call "$TRUST_REGISTRY_ADDRESS" "rulesDocHash(bytes32)(bytes32)" "$id" --rpc-url "$rpc")" != "0x0000000000000000000000000000000000000000000000000000000000000000" ]; then
    echo "$version already published"
    continue
  fi
  RULES_VERSION=$version RULES_URI=$uri RULES_DOC_HASH=$doc_hash \
    forge script script/Admin.s.sol:PublishRules --rpc-url "$rpc" --broadcast --account "$ADMIN_ACCOUNT" --sender "$admin"
done

# 2. House bots (the script refuses a registry that already has bots).
if [ "$(cast call "$BOT_REGISTRY_ADDRESS" "nextBotId()(uint256)" --rpc-url "$rpc")" = "1" ]; then
  eval "$(cd ../../apps/worker && npx tsx src/house/seed-cli.ts forge)"
  HOUSE_HASHES=$HOUSE_HASHES HOUSE_BPS=$HOUSE_BPS HOUSE_TRADES=$HOUSE_TRADES \
    forge script script/Admin.s.sol:SeedHouseBots --rpc-url "$rpc" --broadcast --account "$ADMIN_ACCOUNT" --sender "$admin"
else
  echo "registry already has bots: house bots skipped"
fi
echo "done. Commit broadcast/Admin.s.sol/1990/ and log the tx hashes in docs/decisions.md (#188)."
