#!/usr/bin/env bash
# Simulates the mainnet deploy on a QIE fork (issue #133). It can't send anything: there is no key and
# no --broadcast here, and arguments are refused so neither can be slipped in.
#
# Uses ADMIN_ADDRESS / RUNNER_ADDRESS / COMMITTER_ADDRESS / RELAYER_ADDRESS if set, otherwise Anvil's
# public throwaway accounts. QIE_RPC_URL overrides the RPC, which otherwise goes rpc3 -> rpc4 -> rpc5.
set -euo pipefail

if [ "$#" -ne 0 ]; then
  echo "dry-run.sh takes no arguments" >&2
  exit 2
fi
cd "$(dirname "$0")/.."

export ADMIN_ADDRESS="${ADMIN_ADDRESS:-0xa0Ee7A142d267C1f36714E4a8F75612F20a79720}"
export RUNNER_ADDRESS="${RUNNER_ADDRESS:-0x70997970C51812dc3A010C7d01b50e0d17dc79C8}"
export COMMITTER_ADDRESS="${COMMITTER_ADDRESS:-0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC}"
export RELAYER_ADDRESS="${RELAYER_ADDRESS:-0x90F79bf6EB2c4f870365E785982E1f101E93b906}"

rpc="${QIE_RPC_URL:-}"
if [ -z "$rpc" ]; then
  for n in 3 4 5; do
    url="https://rpc${n}mainnet.qie.digital"
    # cast prints the id in decimal; anything but 1990 means try the next RPC.
    if [ "$(cast chain-id --rpc-url "$url" 2>/dev/null || true)" = "1990" ]; then
      rpc="$url"
      break
    fi
    echo "no answer from $url, trying the next one" >&2
  done
fi
if [ -z "$rpc" ]; then
  echo "no QIE mainnet RPC answered (rpc3, rpc4, rpc5)" >&2
  exit 1
fi

echo "dry run on a fork of $rpc (nothing is sent)"
forge script script/Deploy.s.sol --fork-url "$rpc"
