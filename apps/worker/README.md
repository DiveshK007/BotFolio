# apps/worker — WS B (Runner)
Render web service (Node 20, TS): `/relay`, decision runner, scheduler, indexer, season open/close, DailyCall settle, BotFolio MCP at `/mcp`, `/healthz`. SPEC §6, §10, §10.1, §11.

## Run locally
```bash
pnpm install
cp .env.example apps/worker/.env   # fill in locally; never commit it
pnpm --filter @botfolio/worker dev      # tsx watch
pnpm --filter @botfolio/worker test     # vitest, no network except localhost
pnpm --filter @botfolio/worker build && PORT=10000 node apps/worker/dist/index.js
curl localhost:10000/healthz
```
`LLM_PROVIDER=fake` runs without any LLM key.

## Render
- Service type: Web Service, paid Starter (always-on — free tier sleeps, SPEC §10). Region Singapore.
- Build: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @botfolio/worker build`
- Start: `node apps/worker/dist/index.js` · Health check path: `/healthz`
- Env: everything in `.env.example` that the worker uses, set in the Render dashboard only.

## /healthz
Always HTTP 200 while the process is up (a stale gold price must not make Render restart us). The body says what's degraded:
`{ status: "ok"|"degraded", reasons[], lastSlotRun, oracle: { checkedAt, feeds[{asset, roundId, priceE8, ageSeconds, fresh, …}] }, llm: { provider, month, spentUsd, capUsd, budget } }`. The web's degraded banner (#171) reads `status` and `reasons`.

## RPC
viem `fallback` over `QIE_RPC_URLS` in the order rpc3 → rpc4 → rpc5 → rpc1 → rpc2 (rpc1/rpc2 drop TLS sometimes). A local Anvil fork URL stays first.

## Runner logic (`@botfolio/worker/runner`)
Pure functions the scheduler and the replay script share. Importing this entry point starts nothing.

### `gate(input, output, rulesVersion)` (SPEC §6.4)
- `input` = decision id, bot limits, portfolio and prices as logged for the slot. No clock, no I/O.
- Actions run in order against a simulated ledger (same integer rounding as `PaperLedger`), so the second BUY spends a share of the cash the first one left.
- `actionIndex` is the position in the decision's `actions` array, HOLDs included. It is half of the `orderId`.
- Every clip or drop is an event. `countsForF1: false` for stale prices and paused bots.

| Drop reason | What `PaperLedger` would emit if that were the order's only problem |
|---|---|
| `inactive` | `INACTIVE` |
| `stale` (too old, from the future, or unusable answer) | `STALE` |
| `no_holding`, `zero` (bps 0 or rounds to 0) | `ZERO` |
| `trade_limit`, `coin_cap` | `LIMIT` |
| `low_cash`, `min_order` | none: the 1 % rules exist only in the gate (with no cash at all the ledger says `ZERO`) |

`USED` is never a gate drop: the gate doesn't know chain history.

### Text (SPEC §6.4 step 8)
Take `reason` and `roast` from `GateResult.output`, never from the raw model output. `daily_call` is never in the gate result, because the bot's answer is secret until the user picks (§6.4.1): take it from the decision output through `filterOutput()`. Banned text (slurs, real-money advice, URLs) is replaced there and listed in `textFlags`. `gate_result` is public through `site_decisions`.

### Big moves (SPEC §6.4 steps 9–10)
- BUY to ≥ `BIG_MOVE_BUY_WEIGHT_BPS` of the portfolio, or SELL of ≥ `BIG_MOVE_SELL_BPS` of a holding, lands in `bigMoves`, outside the batch. House bots never do.
- `signApprovedOrder()` signs it. The deadline is decision time + `BIG_MOVE_TTL_MIN`.
- `shrinkBigMove()` is the fallback when the batch is built after the deadline, or at once when the owner taps Shrink. The order keeps its decisionId + actionIndex, so the same orderId.

| `shrinkBigMove` outcome | `big_moves.status` the runner writes |
|---|---|
| `execute` | `shrunk` |
| `already_executed` | `approved` |
| `drop` | `expired` |
| `stale` | leave `pending`, retry at +5/+10/+15 min, then `expired` |
| `not_due` | leave `pending` |

### House bots (SPEC §8)
`houseDecision()` gives a `HouseOutput`. Log it, then pass it to `gate()` with `bot.isHouse: true`.

| Bot | Rule | Trades | Limits it needs to follow the rule |
|---|---|---|---|
| Steady Sam | 20 % in each of the 5 assets | first 09:00 slot of each season | ≥ 2000 bps per coin, ≥ 5 trades/day |
| Gold Granny | 60 % Gold, 40 % cash | first 09:00 slot of each season | 6000 bps, which `BotRegistry` refuses: 5000 is the maximum, so the gate clips her to 50 % |
| Momentum Max | 24 h change > +2 %: top up to 25 %. < −2 %: sell all | every slot | ≥ 2500 bps per coin; 8 trades/day can still run out |

- On a stale retry (+5/+10/+15 min) use the slot's scheduled time, the same decisionId, and pass `alreadyTraded`.
- `actionIndex` is the asset's position in the strategy's list, so it goes up to 4. **`packages/db/schema.sql` only allows 0–2 in `trades.action_index`.** That constraint has to be widened by an announced PR before house trades can be indexed.

### Runner (SPEC §6.1, `src/slot`)
- Needs `DATABASE_URL`, `BOT_REGISTRY_ADDRESS`, `PAPER_LEDGER_ADDRESS`, `DAILY_CALL_ADDRESS`, `RUNNER_PRIVATE_KEY` and the LLM provider's key. Anything missing shows in `/healthz` as `slot` `not_started`.
- Each slot: decide (once per bot), write, then `executeBatch` whatever the chain hasn't executed. +5/+10/+15 gate the stale actions again under the same orderIds.
- The debut watcher polls `nextBotId` every 2 s and writes a pending `bots` row until the indexer confirms it.
- A bot's name and text come from `users.flags.personas[personaHash]` = `{name, emoji, persona, rules}`, if the owner has that draft.
- House bots are matched by name: `Steady Sam`, `Gold Granny`, `Momentum Max` (the seed's, #134).

### Season close (SPEC §2.3, `src/season`)
- At 21:30 IST a season past its end becomes `closing`. The close then writes `season_results` (battle rank against the house bots), builds `season-<n>.jsonl`, uploads it, reads the public copy back, and sends `closeSeason` with its root. The indexer makes the row `closed`.
- Needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PAPER_LEDGER_ADDRESS`, `INDEXER_START_BLOCK` and the committer key, plus a **public** Storage bucket (`REPLAY_BUCKET`, default `replay`).
- Check any season with `pnpm replay <file or URL>`.

### Trust scores (SPEC §7, `src/trust`)
- At the same close, every bot with a season result gets a `trust_scores` row: F1 to F4 over its whole history up to the season's end, the total, `provisional` and the leaf. The rules are in [`docs/trust-rules.md`](../../docs/trust-rules.md).
- The close uploads `season-<n>-scores.json` (every leaf in botId order), reads it back, and sends `commitScores` with its root and the season's `trust_rules_version`. Also needs `TRUST_REGISTRY_ADDRESS`.
- If that rules version isn't published on-chain yet, the data root still goes out. The scores wait, and the next 21:30 run commits them for any closed season without a `scores_root`.
- `GET /trust/proof?season=<n>&bot=<botId>` returns the score and the Merkle proof for `TrustScoreRegistry.verifyScore`. It is public (120 requests a minute per address) and needs `DATABASE_URL`.
