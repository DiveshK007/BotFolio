# Replay a season

Anyone can recompute a closed season and check it against QIE mainnet. Play money. Not investment advice. No prizes.

## Run it

From the repo root:

```bash
pnpm install && pnpm --filter @botfolio/replay build
pnpm replay season-0.jsonl                      # a local file or an https:// URL
pnpm replay 0 --ledger <SeasonLedger address>   # reads dataURI from SeasonLedger.seasons(0)
```

| Flag | Effect |
| :--- | :--- |
| `--ledger <address>` | `SeasonLedger`, needed when you pass a season number. The season must be closed on-chain. |
| `--rpc <url,url>` | QIE RPCs. Default: rpc3, rpc4, rpc5, rpc1, rpc2. |
| `--offline` | Skip the chain checks. |

Exit code: 0 all match, 1 a mismatch, 2 bad usage or an unreadable file ([`scripts/replay/src/main.ts`](../scripts/replay/src/main.ts)). The checks are `verifyOffline` and `verifyOnChain` in [`season/verify.ts`](../apps/worker/src/season/verify.ts). The `SeasonLedger` address is not published yet ([#25](https://github.com/DiveshK007/BotFolio/issues/25)).

## What it checks

Offline (the file alone):
- Every line is canonical JSON, and each decision's `input_hash` and `output_hash` match.
- `gate()` re-run on the logged output gives the logged result, stale retries and big-move expiry shrinks included.
- The data root (keccak256, sorted pairs, over the line hashes) is recomputed.

On chain (skipped with `--offline`):
- The root equals `SeasonLedger.seasons(n).dataRoot`.
- Each trade has a matching `Trade` event, and `getRoundData(roundId)` on the QIE feed returns the price it used.
- Each bot's cash and holdings, recomputed from all its `Trade` events, equal the ledger's.

## What is and isn't reproducible

- **Not reproducible:** the LLM's answer. Calls use temperature 0 where the model accepts it and a logged model id, but the same input can give a different output. So the output is logged, not regenerated.
- **Reproducible:** everything after the logged output: the gate, the orders, balances and marks, given the oracle rounds the file names.
- The file is built at season close ([`season/replay-file.ts`](../apps/worker/src/season/replay-file.ts)). The worker verifies it offline before upload, uploads it to public Supabase Storage and commits its root in `SeasonLedger.closeSeason`. Output hashes are revealed before the build ([`decisions/secrecy.ts`](../apps/worker/src/decisions/secrecy.ts)), so a closed season's file is complete.

## Not verified

- UNVERIFIED: that the replay CLI recomputes trust scores. SPEC §6.5 says it does; [`scripts/replay/README.md`](../scripts/replay/README.md) lists only the checks above. Trust scores have their own proof check: [trust-rules.md](trust-rules.md).
- Not run against mainnet data: no season is closed on-chain yet.
