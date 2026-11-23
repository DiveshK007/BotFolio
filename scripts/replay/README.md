# scripts/replay — WS B

`botfolio-replay` recomputes a season from its replay file (SPEC §6.5):
- every line is canonical JSON, and every decision's `input_hash` and `output_hash`;
- `gate()` gives the logged result again, stale retries and big-move expiry shrinks included;
- the data root (keccak256, sorted pairs, over the line hashes) equals `SeasonLedger.seasons(n).dataRoot`;
- each trade's `Trade` event, and `getRoundData(roundId)` on the QIE feed it priced against;
- each bot's cash and holdings, recomputed from all of its `Trade` events, equal the ledger's.

```bash
pnpm install && pnpm --filter @botfolio/replay build
pnpm replay season-0.jsonl              # a local file or an https:// URL
pnpm replay 0 --ledger <SeasonLedger>    # fetches the file the chain points to
```

`--offline` skips the chain checks. `--rpc <url,url>` picks other RPCs. The exit code is 0 when everything matches.

The file is built by the worker (`apps/worker/src/season/replay-file.ts`) when a season closes (#56).
