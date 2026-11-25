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
- After `closeSeason`, each accepted challenge of the season is settled (`Challenges.settle`) and each open one expired, so its slot frees up. The winner is the higher season return, then the lower max drawdown; on an exact tie, the bot created first. Anyone can recompute it from `site_season_results`. A closed season that still has open or accepted challenges is retried at the next 21:30. Also needs `CHALLENGES_ADDRESS`.
- Check any season with `pnpm replay <file or URL>`.

### v2 proposals (SPEC §2.3, `src/v2`)
- After each close (the same 21:30 job), every active raised bot with a season result gets a proposed next version. The input is its current rules and limits, the season's results and its indexed corrections from the season.
- The model (`LLM_MODEL_V2`) answers the §6.3 v2 schema. Changes citing a correction that isn't this bot's this season are dropped; banned or URL text is cleaned; limits are clamped to 10–50 % / 1–8.
- If the model fails, changes nothing, or the budget is resting, a deterministic fallback moves one slider one step:
  - direction: the chip cited most, else careful after a loss or a drawdown of 10 % or more, else bolder;
  - step: max per coin by 5 points, or trades per day by 1 at its bound.
  - So every bot gets a diff. A worker without an LLM key only makes fallbacks.
- A proposal is a `bot_versions` row with `committed_tx` null and `source = 'season_v2'`. `config_json` is the whole proposal, and `config_hash = keccak256(canonical config_json)`: what the owner signs in `commitVersion(botId, version, configHash, maxPerCoinBps, maxTradesPerDay)`.
- The runner only uses committed versions, so a proposal changes nothing until approved. `approve_by` is 08:30 IST the next morning; after that the app should stop offering it. The next season's proposal replaces an unapproved one, and a committed version is never overwritten.

### Approve Big Move, the owner's side (SPEC §2.2, `src/big-moves/route.ts`)
- `POST /big-moves` (signed in): the owner's pending big moves, each with the `ApprovedOrder` and the runner's signature. The app relays `executeApproved(order, runnerSig)` through the forwarder. The signature is never anon-readable.
- `POST /big-moves/shrink {orderId}`: ends the 2 h window now, so the next sweep (≤ 10 min) sends the safe-size order under the same orderId. `usedOrder` lets only one of the two execute.
- Block is the owner's signed correction with chip "blocked"; when it is indexed, the decision's pending big moves become `blocked` and the sweep leaves them alone.

### Daily Call, the owner's side (SPEC §2.2, §6.4.1, `src/daily-call/route.ts`)
- `POST /daily-call` (signed in): today's state for each of the owner's active bots, plus the IST `day` and the 20:00 `closesAt`. No bot view in it.
  - `waiting`: the bot's 09:00 (or debut) decision hasn't run yet; `open`: a signed view exists and it's before 20:00; `called`: the owner's call is indexed; `closed`: 20:00 or later.
  - `joins_tomorrow`: the bot decided since 09:00 without a view, e.g. a late bot whose debut decision left `daily_call` out or was invalid. The app hides Daily Call and shows "Your bot joins tomorrow's call".
- `POST /daily-call/view {botId}`: only while `open`, the runner-signed `SignedDailyCallBotView`. The app asks after the user picks, then relays `DailyCall.call(botId, userUp, botUp, botSig)`. `bot_up_sig` is never anon-readable and the view is never logged.

### Cards (SPEC §9, `src/cards`)
- Payloads follow the frozen `packages/shared/src/cards.ts`. Each card's id comes from what it is about, so it is written once:
  - `trade-<bot>`: the first trade;
  - `roast-<bot>-<slot>`: a slot loss of 3 % or more;
  - `recap-<bot>-<IST day>`: the daily recap.
- Every tx hash in a payload must also be in `cites`, or `saveCard` refuses it.
- A one-minute sweeper (same pool as the read routes) writes first-trade and slot-loss cards. A newcomer's first trade gets its card within a minute.
- The `recap` job (21:35 IST) runs the same sweep, then writes one recap per active raised bot, quiet days included: the day's change, best and worst call, and rank in the season.
- Prices are as recorded. A round or block time we didn't store is read from QIE (`getRoundData`, `getBlock`), never estimated. Needs `PAPER_LEDGER_ADDRESS` (₹ rule) and `DATABASE_URL`.
- The same sweep writes the cards that follow a close or a settlement, each once:
  - `battle-<bot>-s<n>` and `season-<bot>-s<n>`: for each raised bot once the season's close is indexed. They cite the `closeSeason` tx. Battle needs exactly 3 house bots.
  - `evolution-<bot>-v<n>`: when the owner commits a v2. It shows the diff and the chip behind it ("too risky" ×N), and cites the commit.
  - `challenge-<code8>-<bot>`: for each side of a settled challenge. The settle tx is found with `getLogs` after the close, so it needs `CHALLENGES_ADDRESS`.
  - `call-<bot>-<day>`: a settled Daily Call, with the season's score and the owner's streak. It cites the call and the settle.

### MCP server (SPEC §10.1, `src/mcp`)
- `POST /mcp`: a read-only MCP server over Streamable HTTP. It is stateless (JSON-RPC in, JSON out, no session, no server-sent stream: `GET /mcp` is 405). It has three tools:
  - `get_bot_record(bot_id | name)`: versions with config hashes, the latest 50 trades with tx hashes and round ids, season results, and the trust score with its Merkle proof.
  - `get_leaderboard(board, season?)`: the top 20 of one board, for the current season by default.
  - `verify_trade(tx_hash)`: re-reads the tx's `Trade` events and each oracle round from QIE RPC, not from the database.
- No writes, no keys. 60 requests a minute per address. Needs `DATABASE_URL` and `PAPER_LEDGER_ADDRESS`.
- To try it from Claude Desktop: Settings → Connectors → add a custom connector with `https://<worker host>/mcp`. UNVERIFIED until tried against the deployed service.

### Leaderboards (SPEC §8, `src/season/leaderboards.ts`)
- `GET /leaderboards?season=<n>` returns Top Returns, Best Risk-Adjusted (Sortino), Most Trusted and Coach vs Bot, ranked with §8's eligibility and tiebreaks. The last tiebreak on every board is the bot created first.
- A closed season reads what its close stored (`season_results`, `trust_scores`). An open one is live: returns and Sortino come from the marks so far, and Most Trusted from the latest scored season (`trustSeason`).
- House bots are listed with `isHouse` but get `rank: null`, so #1 is always a human-raised bot.
- Coach vs Bot counts the owner's Daily Calls that have a result in the season's IST days. It needs 2 in a sprint season and 4 in a weekly one, and orders by win rate, then right calls.
- Public, 120 requests a minute per address, cached for a minute per season. Needs `DATABASE_URL` and `PAPER_LEDGER_ADDRESS`.

### Trust scores (SPEC §7, `src/trust`)
- At the same close, every bot with a season result gets a `trust_scores` row: F1 to F4 over its whole history up to the season's end, the total, `provisional` and the leaf. The rules are in [`docs/trust-rules.md`](../../docs/trust-rules.md).
- The close uploads `season-<n>-scores.json` (every leaf in botId order), reads it back, and sends `commitScores` with its root and the season's `trust_rules_version`. Also needs `TRUST_REGISTRY_ADDRESS`.
- If that rules version isn't published on-chain yet, the data root still goes out. The scores wait, and the next 21:30 run commits them for any closed season without a `scores_root`.
- `GET /trust/proof?season=<n>&bot=<botId>` returns the score and the Merkle proof for `TrustScoreRegistry.verifyScore`. It is public (120 requests a minute per address) and needs `DATABASE_URL`.
