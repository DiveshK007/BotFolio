# Incident runbook

What to do when something breaks on the live service. Each section is symptom → check → fix → who. Rolling back a bad deploy is in [`rollback.md`](rollback.md).

Steps marked **UNVERIFIED** were written from the code and the docs, not tried on the live service. First-run checks for each scheduled path are in section 9, the Dec 1–7 on-call table in section 10, and the daily no-merge windows in [`release.md`](release.md) section 8. Never paste a key, `DATABASE_URL` or any other secret into a chat, an issue or this file.

## Where to look first

| What | Where |
|---|---|
| Worker health | `GET <RENDER_SERVICE_URL>/healthz`. It always answers 200 while the process is up. Read `status` (`ok` / `degraded`) and `reasons` |
| Worker logs | Render dashboard → the service → Logs. One JSON line per event, e.g. `{"event":"runner.batch_failed",...}` |
| A wallet's balance | `cast balance <address> --ether --rpc-url https://rpc3mainnet.qie.digital` |
| A tx | `https://mainnet.qie.digital/tx/<hash>` |
| Is an RPC alive? | `cast block-number --rpc-url https://rpc3mainnet.qie.digital` (repeat for rpc4, rpc5, rpc1, rpc2) |

`/healthz` fields that matter:
- `reasons`: plain text, e.g. `GOLD price too old`, `BTC feed unreadable`, `LLM budget used up — bots resting`, `slot job not started: needs RUNNER_PRIVATE_KEY`, `slot job failed for 3 bot(s)`.
- `lastSlotRun`: the last decision slot that finished.
- `oracle.feeds[]`: per asset `ageSeconds`, `maxAgeSeconds`, `fresh`, `error`. Refreshed every `ORACLE_REFRESH_MS` (default 60 s).
- `llm`: `provider`, `spentUsd`, `capUsd`, `budget` (`uncapped` / `ok` / `alert` / `resting`).
- `jobs`: each scheduler job's state and last run.

`/healthz` answers 200 even when `degraded`, so a stale price or a resting budget never makes Render restart the service. **UNVERIFIED**: that the Render service's health check path is set to `/healthz`.

## Who

| Area | Person |
|---|---|
| Worker, relayer, runner, scheduler, indexer (WS B) | Gokul |
| Hot wallets, top-ups, QIE checks | Divesh |
| Admin cold key (role grants and revokes) | Holder of `ADMIN_ADDRESS` 0x24bA066120Dbb76bd6EbF86bc66236E1D9CD7457 (deployed Nov 26, `docs/decisions.md`). **UNVERIFIED** who; write the name here (H24) |
| Render and Vercel dashboards | Whoever has access. **UNVERIFIED**: list the names here |

---

## 1. Restart the worker

**When:** the process is stuck, or after any env var change. Render env changes only apply after a restart or redeploy.

**Fix:**
1. Render dashboard → the service → **Manual Deploy → Restart service**, or save the env change and let Render redeploy. **UNVERIFIED** menu wording.
2. Watch the logs for `[worker] listening on :<port> · chain 1990 · rpc ... · llm <provider>` and `{"event":"scheduler.started",...}`.
3. Check `/healthz`. `reasons` should hold nothing new.

**Safe to do at any time.** On `SIGTERM` the worker lets a broadcast and an indexer batch in progress finish, waits up to 10 s, then exits. Every job is idempotent:
- A restart inside a slot's 20-minute window (slot time to +20 min) runs that slot again at start-up. Bots already decided are not decided or charged again. Orders already on-chain are not sent again.
- `season_open` and `season_close` run once at every start.
- The relayer reloads relays submitted in the last hour from `relay_log` and keeps watching them.

**Who:** Gokul, or anyone with Render access.

## 2. Oracle stale for hours

QIE's feeds sometimes stop updating: gold for more than 6 h, crypto for more than 30 min (SPEC §14 risk 2). This is expected and is handled. It is not an outage. Trades are settled against QIE's official mainnet oracle, and the contracts read the price themselves at execution time.

**Symptom:** `/healthz` is `degraded` with `GOLD price too old` (or BTC, ETH, SOL, XRP). `oracle.feeds[].ageSeconds` is above `maxAgeSeconds` (1800 crypto, 21600 gold).

**What the system already does** (no action needed):
- At the slot the gate drops orders for the stale asset. At +5, +10 and +15 min the runner checks again (`{"event":"runner.retried",...}`). It does not call the LLM again. Still stale after +15 → that asset holds for the slot. The bot's other assets still trade.
- The runner only sends orders whose asset is fresh. If a price goes stale between the check and the tx, `PaperLedger.executeBatch` skips that order and does not revert the batch.
- Daily Call settlement waits for a fresh BTC round: `{"event":"daily_call.settles_late",...}` every 10 min until 23:50 IST, then once more at the next 09:00.

**Check:**
1. Confirm the feed itself is old, not our read. `oracle.feeds[].error` is empty and `updatedAt` is old. On the explorer, open the feed address (SPEC §0.2) and look at its last update.
2. If `error` is set instead (`<ASSET> feed unreadable`), it is an RPC problem: go to section 4.

**Fix:** none on our side. Do **not** raise `MAX_AGE_CRYPTO_S` / `MAX_AGE_GOLD_S`. The contracts' limits are fixed at deploy, so the worker would only plan orders the ledger then skips.

**Tell users** if it lasts hours: "Gold price is old on QIE's oracle, so bots are holding gold until it updates." Never call it an error on our side, and never say "trustless" or "decentralised".

**Who:** Gokul watches. Divesh tells the QIE team if a feed is stuck for more than a day. **UNVERIFIED**: the QIE contact channel.

## 3. LLM down, or budget used up

### 3a. Provider down or failing
**Symptom:** in the logs, `{"event":"llm.decision","status":"invalid",...,"error":"timeout: ..."}` (or `http`, `invalid_json`, `schema_mismatch`, `refusal`) for most bots in a slot.

**What the system already does:** each call has a 20 s timeout (`LLM_TIMEOUT_MS`) and one retry. After that the decision is stored as `invalid` and the bot holds, with the line "<name> lost its train of thought, so it's holding this slot." One bot's failure never stops the slot. Season-close v2 proposals fall back to `v2-fallback-v1`.

**What breaks:** `POST /persona` (making a new bot) answers `502 PERSONA_FAILED`, logged as `{"event":"persona.failed",...}`. So the newcomer path is down while the LLM is down.

**Check:** the provider's status page. Is it every bot, or a few (one bad persona)?

**Fix:**
1. Short outage (under about an hour): wait. The next slot recovers by itself.
2. Long outage: switch provider. Production is `LLM_PROVIDER=anthropic` (Claude Haiku 5.5). Set `LLM_PROVIDER=xai` and `XAI_API_KEY` (or `openai` and `OPENAI_API_KEY`) in Render, and the model vars `LLM_MODEL_DECISION`, `LLM_MODEL_PERSONA`, `LLM_MODEL_V2` to that provider's model names. Then restart (section 1). Log the switch in `docs/decisions.md`. **UNVERIFIED**: the OpenAI and Anthropic clients have not run against the live decision schema.
3. Never set `LLM_PROVIDER=fake` in production. The runner refuses to start the slot job with it (`slot job not started: needs LLM_PROVIDER`).

### 3b. Key missing or wrong
**Symptom:** `/healthz` reason `slot job not started: needs ANTHROPIC_API_KEY` (production runs `LLM_PROVIDER=anthropic` with Claude Haiku 5.5 since Nov 26; `XAI_API_KEY` for `xai`). Or every call fails with `http` status 401/403.

**Fix:** set the right key in Render env and restart. Get a new key from the provider console if it was revoked.

### 3c. Monthly budget reached
**Symptom:** `/healthz` reason `LLM budget above 80 %` (state `alert`) or `LLM budget used up — bots resting` (state `resting`). Log line `{"event":"llm.budget","state":"resting"}` before each slot.

**What the system already does:** spend is summed from the `decisions` table, so a restart doesn't reset it. At `resting` the runner skips the LLM, every bot holds with "<name> is resting this slot. Holding until it's back.", and `POST /persona` answers `503 BUDGET_RESTING`. Persona and v2 calls are not counted in the spend (SPEC §6.6 puts them under 10 %).

**Fix:** decide with Divesh whether to raise `LLM_MONTHLY_BUDGET_USD`. If yes, set it in Render and restart. The budget resets on the 1st of the month (UTC).

**Alert:** the worker posts to the alert webhook when spend passes 80 % (kind `llm_budget_alert`) and again when it is used up (`llm_budget_resting`), once per month each (see §5b for the webhook). `/healthz` and the `llm.budget` log line still show the state.

**Who:** Gokul for the switch. Divesh for budget and provider keys.

## 4. RPC down

**Symptom:**
- `/healthz` reasons `<ASSET> feed unreadable` for all five assets.
- `POST /relay` answers `RPC_UNAVAILABLE` ("Can't reach QIE right now. Nothing was sent.").
- Indexer logs `[indexer] tick failed, retrying` or `[indexer] no new blocks for a minute`.
- `runner.bot_failed` or `scheduler.job_failed` during a slot.

**What the system already does:** every client tries the URLs in `QIE_RPC_URLS` in a fixed order: rpc3 → rpc4 → rpc5 → rpc1 → rpc2. rpc1 and rpc2 go last because they drop TLS sometimes. Each URL has a 10 s timeout. Reads move to the next URL on any error. One working RPC is enough.

**Check:** run `cast block-number` against each of the five RPCs. Are they up, and do their block numbers move?

**Fix:**
1. Some RPCs down: nothing to do. Failover handles it.
2. All five down: QIE itself is unreachable. Wait. Nothing is lost:
   - Stale retries run up to +15 min. The slot job can rerun until +20 min after the slot. Later than that the slot is skipped (`scheduler.slot_outside_window`) and bots hold. Their next slot is normal.
   - The indexer resumes from the last indexed trade's block.
   - Relays are refused before broadcast, so users can simply try again.
3. If a new official QIE RPC is announced, add it to `QIE_RPC_URLS` (comma-separated) and restart. Use QIE's official endpoints only.

**Who:** Gokul. Divesh asks QIE if all five are down for more than 30 min.

## 5. Hot wallet out of gas, top-up, low balance

The three hot wallets are separate keys: relayer (`RELAYER_PRIVATE_KEY`, pays for user actions), runner (`RUNNER_PRIVATE_KEY`, `executeBatch` each slot), committer (`COMMITTER_PRIVATE_KEY`, Daily Call settle, season open/close, trust scores). Their addresses are the `RELAYER_ADDRESS`, `RUNNER_ADDRESS` and `COMMITTER_ADDRESS` used at deploy (`packages/contracts/README.md`).

**Float and alert threshold:** keep **10 QIE** in each. Top up below **2 QIE** (`LOW_BALANCE_ALERT_QIE=2`, SPEC §4.10). At the sizes in [`gas.md`](gas.md) (100 bots) 10 QIE lasts the relayer about 310 days and the runner about 260 days at 1.125 gwei.

**Alert:** the worker checks the relayer, runner and committer balances every 10 minutes (only wallets whose key is set on that deploy). Below `LOW_BALANCE_ALERT_QIE` (default 2) it posts `Low balance: <label> wallet <address> has <n> QIE` to the alert webhook, kind `low_balance:<label>`, at most once an hour per wallet while it stays low. An unreadable balance logs `alerts.balance_unreadable`; a non-numeric `LOW_BALANCE_ALERT_QIE` turns the check off (`alerts.balance_check_off`). Setup and test: see §5b.

**Symptom, relayer empty:** user actions fail with `INTERNAL` ("Something went wrong on our side. Nothing was sent."). The logs show `{"event":"relay.refused","code":"INTERNAL",...,"cause":"broadcast_rejected"}`. The node refused the tx with "insufficient funds". **UNVERIFIED**: the exact refusal wording on QIE nodes, and whether the refusal can come earlier as `RPC_UNAVAILABLE`.

**Symptom, runner empty:** `{"event":"runner.batch_failed",...}` every slot, and no `runner.batch_sent`. Decisions are still made and stored. The orders wait.

**Symptom, committer empty:** `scheduler.job_failed` for `daily_call_settle`, `season_open` or `season_close`.

**Fix (top-up):**
1. Check the balance with `cast balance <address> --ether --rpc-url https://rpc3mainnet.qie.digital`.
2. Send QIE to that address from the team's funding wallet. Only the address is needed, never the key.
3. Nothing to restart. The next relay, slot or settle run uses the new balance.
4. Runner: orders decided earlier in the same slot are sent on the next stale retry (+5 min) or the next rerun, if they are still inside the 20-minute window. Later than that those orders are not sent.

**Stop the drain first** if a wallet emptied much faster than [`gas.md`](gas.md) predicts:
- Relayer: set `RELAY_ENABLED=false` in Render and restart. `/relay` then answers `RELAY_DISABLED` ("Actions are paused right now. Nothing was sent.") and no key is used. Look at `relay_log` for the wallet or IP behind the volume. The rate limits are `RELAY_MAX_PER_USER_PER_DAY` (30), `RELAY_MAX_GLOBAL_PER_HOUR` (2000) and `NEW_BOTS_PER_IP_PER_DAY` (3).
- A gas price above 25 gwei is refused in code (`gas_price_above_cap`), so a bad RPC quote can't drain a wallet.

**Who:** Divesh tops up. Gokul investigates a fast drain.


## 5b. Alert webhook

Code: `apps/worker/src/alerts`. Set `ALERT_WEBHOOK_URL` in Render (https only; it holds the hook's token, so it is never logged). If it is unset or not https the worker logs `alerts.disabled` once and sends nothing. Every alert is logged as `alerts.notify` with `kind` and `sent`; a failed POST logs `alerts.send_failed` and is retried on the next check.

**What alerts, checked every 10 minutes:**
- Low balance per relayer/runner/committer wallet (see section 5).
- LLM budget at 80 % and at 100 %, once per month each (section 3c).
- A scheduled job that failed (once per failed run) or never started. Routine stale-oracle holds do not alert.

**Payload:** `POST` JSON `{"text", "content", "kind", "at"}`. Same kind repeats at most once an hour. `text` is ours only: addresses, balances, job names. **UNVERIFIED:** that Slack incoming webhooks (read `text`) and Discord webhooks (read `content`) accept this payload; test against the real hook before relying on it.

**Send a test alert:** in Render set `LOW_BALANCE_ALERT_QIE` to a number above the wallets' balances (for example `1000000`) and redeploy. Within one check (10 minutes at most, the first runs at start) expect a `low_balance` message per wallet in the channel and `alerts.notify` lines with `sent:true`. Then set `LOW_BALANCE_ALERT_QIE` back to `2` and redeploy.

## 6. Key rotation

Rotate when a key may have leaked (it appeared in a log, a chat or a commit), or when someone with access leaves. Generate new keys offline, e.g. `cast wallet new`, on the rotating person's own machine. A key goes only into the Render env.

The worker refuses to start a wallet whose key equals another wallet's key (`RELAYER_PRIVATE_KEY`, `RUNNER_PRIVATE_KEY`, `COMMITTER_PRIVATE_KEY`, `DEPLOYER_PRIVATE_KEY` must all differ).

### Relayer
The relayer has no on-chain role. The forwarder accepts a signed request from any sender.
1. Make the new key and fund its address (section 5).
2. Set `RELAYER_PRIVATE_KEY` in Render to the new key. Restart.
3. Check that a relay goes through: `{"event":"relay.submitted",...}`, and the tx on the explorer comes from the new address.
4. Move what is left on the old address to the new one. If the key leaked, do this first, before the restart.

### Runner or committer
These hold roles on the contracts, so the admin cold key has to act. Roles (`packages/contracts/README.md`):
- `RUNNER_ROLE` on `PaperLedger` and `DailyCall`.
- `COMMITTER_ROLE` on `SeasonLedger`, `TrustScoreRegistry`, `DailyCall` and `Challenges`.

1. Make the new key and fund its address.
2. Read the role id from the contract, e.g. `cast call $PAPER_LEDGER_ADDRESS "RUNNER_ROLE()(bytes32)" --rpc-url https://rpc3mainnet.qie.digital`.
3. The admin key holder grants that role to the new address on every contract above, with `grantRole(bytes32,address)` and their own signer. Then they revoke it from the old address with `revokeRole(bytes32,address)`. **UNVERIFIED**: there is no script for this yet. It is a plain OpenZeppelin `AccessControl` call, so `cast send` with the admin's hardware or local signer works.
4. Check: `cast call <contract> "hasRole(bytes32,address)(bool)" <role> <new address>` returns `true`, and for the old address `false`.
5. Set the new key in Render and restart. Watch the next slot for `runner.batch_sent`, or the next settle for `daily_call.settled`.

If the key leaked, revoke the old address's role first. That stops the attacker writing to the ledgers. Then do the rest. Between revoke and restart the worker's sends fail, which is safe: the jobs are idempotent and catch up.

### Other secrets
- `RELAY_JWT_SECRET`: change it in Render and restart. Every QIE Wallet sign-in token becomes invalid, and those users sign in again. Privy users are not affected.
- `XAI_API_KEY` (or the other provider keys), `PRIVY_APP_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` password: make a new one in that provider's console, set it in Render (and Vercel if used there), restart, then revoke the old one in the console. **UNVERIFIED**: each console's exact steps.

**Who:** the person who found the leak starts it right away. Divesh for wallets. The admin key holder for roles. Gokul for Render.

## 7. Pause switches

| To stop | Do | Effect |
|---|---|---|
| All relayed user actions | `RELAY_ENABLED=false`, restart | `/relay` answers `RELAY_DISABLED`. Nothing is broadcast |
| Runner trades | Remove `RUNNER_PRIVATE_KEY`, restart | `slot job not started: needs RUNNER_PRIVATE_KEY`. No decisions, no trades |
| A runner or committer on-chain | Admin revokes its role (section 6) | Its txs revert at the estimate and nothing is spent |

Write every pause and its reason in `docs/decisions.md`.

## 8. Dec 7 switch: sprint to weekly seasons (written Nov 25 2026)

S4 closes Sun Dec 6 21:30 IST. S5, the first weekly season, opens Mon Dec 7 00:00 IST and closes Sun Dec 13 21:30 IST (calendar re-seeded Nov 26, `docs/decisions.md`). The worker reads every boundary, the provisional threshold (8 → 20 trades) and the trust rules version (`trust-v1-sprint` → `trust-v1`) from the `seasons` rows, so there is no deploy and no env change. `TRUST_RULES_VERSION` and `PROVISIONAL_MIN_TRADES_*` in `.env.example` are not read by the worker.

Two checks, done before Sun Dec 6:

1. **The weekly rows are in the live database.** In the Supabase SQL editor:
   ```sql
   select id, starts_at at time zone 'Asia/Kolkata' as opens, ends_at at time zone 'Asia/Kolkata' as closes,
          kind, provisional_min_trades, trust_rules_version, status
   from seasons where id between 4 and 18 order by id;
   ```
   Expect S4 `sprint, 8, trust-v1-sprint` ending Dec 6 21:30, then S5 to S18 `weekly, 20, trust-v1`, each Monday 00:00 to Sunday 21:30, S18 ending Mar 14 2027. If rows are missing or still on the old calendar, run `packages/db/seeds/seasons.sql` (it leaves rows that have slots or a close tx alone). If S5 is missing on Dec 7, the 00:00 job logs `seasons.no_next_row` and S5 is not opened.
2. **`trust-v1` is published on-chain.** Non-zero means published:
   ```bash
   cast call $TRUST_REGISTRY_ADDRESS "rulesDocHash(bytes32)(bytes32)" $(cast format-bytes32-string trust-v1) \
     --rpc-url https://rpc3mainnet.qie.digital
   ```
   If it returns zero, the admin key holder publishes it with `script/Admin.s.sol:PublishRules` and `RULES_VERSION=trust-v1` ([`packages/contracts/README.md`](../packages/contracts/README.md), "Publish trust rules"). Use the same `docs/trust-rules.md` bytes, URI and hash as `trust-v1-sprint`: that doc defines both versions. Both were published on Nov 26 (txs in `docs/decisions.md`); on Nov 27 `rulesDocHash(trust-v1-sprint)` returned `0xba735a34…326ea1` on rpc3, so this check should pass.

Without step 2, S5's close still commits the data root, but not the trust scores (`season.trust_rules_unpublished` in the logs). Publishing later is enough: the next close run commits them.

On the day, check the logs:
- Sun Dec 6 21:30 IST: S4 goes `closing`, then `closed` once its `SeasonClosed` event is indexed.
- Mon Dec 7 00:00 IST: `seasons.opened` with `season: 5`. Check on-chain with `cast call $SEASON_LEDGER_ADDRESS "nextSeason()(uint32)"`, which should return 6.
- From then on, the daily 21:30 close check does nothing until Sun Dec 13 21:30.

Known limit: S18 is the last seeded row. From Mon Mar 15 2027 00:00 IST, `season_open` logs `seasons.no_next_row` each day (no job failure, #313) and opens nothing until rows from S19 on are added to the seed.

**Who:** Gokul for the database check. The admin key holder for `publishRules`.

## 9. First-run checks (paths not yet seen working on mainnet)

Written Nov 27 2026, about 02:30 IST, from the code on `main` at 5ac9411. At that time the chain said: S0 open (`nextSeason() = 1`, `seasonState(0) = 1`), `nextBotId() = 5` (house bots 1–3 plus user bot #4), bot #4 with its starting cash and no holdings, and no `Trade` event yet. None of the paths below had run on mainnet, so every expected log line and result here is **UNVERIFIED** until someone sees it and writes the date next to it.

All checks are read-only: `/healthz`, the Render logs, SQL in the Supabase SQL editor, and `cast call`. Nothing here sends a transaction. The manual fallbacks at the end of 9.3 and 9.4 do send one, and only a key holder runs them.

**Setup, once per shell:**

```bash
cd packages/contracts
set -a; . deployments/1990.env; set +a      # public contract addresses only
RPC=https://rpc3mainnet.qie.digital
W=<RENDER_SERVICE_URL>                      # the worker's public URL
curl -s $W/healthz | jq '{status, reasons, startedAt, lastSlotRun, jobs, feeds: [.oracle.feeds[] | {asset, ageSeconds, maxAgeSeconds, fresh, error}], llm}'
cast call $DAILY_CALL_ADDRESS "today()(uint32)" --rpc-url $RPC   # today's IST day number: Nov 27 = 20784, Nov 28 = 20785
```

- In the Render logs, search for the `event` value, e.g. `runner.batch_sent`. Each line is one JSON object.
- `cast logs` on QIE answers for at most **10,000 blocks** per query (about 10 h at about 3.6 s a block). Use `--from-block $(( $(cast block-number --rpc-url $RPC) - 9000 ))`.
- SQL times are UTC. Add `at time zone 'Asia/Kolkata'` to read them in IST.
- Hot wallets: runner 0x33b62A52e8522816bC6BCE0E9026eD01D622A181, committer 0xd27710cB6166560fe86d0aE4Ad412904F7f15D45, relayer 0x59556d09E63D96FF1053fE065c0f678906f58004. Their txs are system txs, never user activity.
- Enum values that `cast call` prints as numbers: season state 0 NONE, 1 OPEN, 2 CLOSED. Challenge status 0 NONE, 1 OPEN, 2 ACCEPTED, 3 SETTLED, 4 EXPIRED. `OrderSkipped.reason` 0 STALE, 1 LIMIT, 2 INACTIVE, 3 ZERO, 4 USED.

### 9.1 Scheduled slot (09:00, 13:00, 17:00, 21:00 IST, retries +5, +10, +15 min)

**Before the slot:** `/healthz` `jobs.slot.state` is `scheduled`, not `not_started` (its `detail` names the missing variable). Note which `feeds[]` are `fresh`. A stale asset holds for the slot, which is expected (section 2).

**Logs, in order:**
1. `llm.decision` per raised bot (`status` `ok`, or `invalid` with an `error`), then `runner.decided` with `botId`, `status` (`executed` / `held` / `skipped_stale` / `invalid`), `orders` and `bigMoves`.
2. `runner.batch_sent` with `orders` and `txHash`. If there is no order (every bot held), there is no batch line.
3. At +5, +10 and +15 min, for orders held back by a stale price: `runner.retried` with `attempt` and `orders`.
4. `scheduler.slot_done` with `slotId`, `slotTime`, `attempt` and `failed`. `failed > 0` is how many bots errored.

**/healthz after:** `lastSlotRun.slotTime` is this slot and `lastSlotRun.kind` is `scheduled`. `jobs.slot.lastRun.problem` is empty. A value of `failed for N bot(s)` also shows in `reasons`.

**SQL:**
```sql
-- the last day's slots and what each decided
select s.id, s.slot_time at time zone 'Asia/Kolkata' as ist, s.kind, s.season_id,
       count(d.id) as decisions,
       count(*) filter (where d.status = 'executed') as executed,
       count(*) filter (where d.status = 'held') as held,
       count(*) filter (where d.status = 'skipped_stale') as stale,
       count(*) filter (where d.status = 'invalid') as invalid
from slots s left join decisions d on d.slot_id = s.id
where s.slot_time > now() - interval '1 day'
group by s.id order by s.slot_time desc;

-- one slot: prices it saw, then trades (tx_hash null = sent but not indexed yet)
select asset, round_id, updated_at at time zone 'Asia/Kolkata' as price_time, fresh from oracle_reads where slot_id = <slot id>;
select t.bot_id, t.asset, t.side, t.tx_hash, t.block_number
from trades t join decisions d on d.id = t.decision_id where d.slot_id = <slot id> order by t.id;
```

**On-chain:**
```bash
cast nonce 0x33b62A52e8522816bC6BCE0E9026eD01D622A181 --rpc-url $RPC            # goes up by 1 per batch
cast call $PAPER_LEDGER_ADDRESS "portfolios(uint256)(uint128,uint16,uint8,bool)" <botId> --rpc-url $RPC   # cash, lastDay, tradesToday, init
cast call $PAPER_LEDGER_ADDRESS "holdings(uint256)(uint256[5])" <botId> --rpc-url $RPC                     # BTC ETH SOL XRP GOLD units, 18 decimals
cast logs --from-block <block> --address $PAPER_LEDGER_ADDRESS \
  "OrderSkipped(uint256 indexed botId,uint8 indexed asset,bytes32 indexed decisionId,uint8 actionIndex,uint8 reason)" --rpc-url $RPC
```
Open the `txHash` from `runner.batch_sent` on `https://mainnet.qie.digital/tx/<hash>`. It is from the runner, to PaperLedger, with `Trade` and maybe `OrderSkipped` events.

**If it fails:**
| What you see | Do |
|---|---|
| No `scheduler.slot_done` by +20 min, and no `scheduler.started` near the slot | The worker was asleep or down. Check that the UptimeRobot ping is green and Render shows the service live. A restart inside the 20-min window reruns the slot (section 1). After that the slot is skipped (`scheduler.slot_outside_window`), and bots hold until the next one. |
| `jobs.slot.state` is `not_started` | Fix the named env variable in Render, then restart. |
| Every decision `skipped_stale` or `held` with stale reasons | Expected when QIE's feeds are old (section 2). Nothing to fix. |
| Most `llm.decision` lines `invalid` | Section 3a. |
| `runner.batch_failed` | Runner balance (section 5), RPC (section 4). The orders are sent again on the next retry inside the window. If the tx was mined but reverted out of gas, it may be the QIE gas-estimate problem (#339, PRs #340 and #341). Send Gokul or Claude the log line. |
| `runner.bot_failed` with a `stage` | One bot. The others went on. Send the `botId` and `stage`. |

### 9.2 Debut (first trade of a new bot, within about 10 s of `createBot`)

**Logs:** `persona.created`, then `relay.submitted` with selector `0xf429b088` (`createBot`). Within seconds, `llm.decision` and `runner.decided` with the new `botId`, then `runner.batch_sent`. On failure: `debut.failed` with `botId` and `error` (up to 3 tries, within 10 min of the bot's creation), or `debut.poll_failed` (the `nextBotId` poll can't read the chain; logged once per outage).

**/healthz:** a debut doesn't show there at all. `lastSlotRun` is only set by scheduled slots, and a debut failure isn't a `reason` (master plan A2 adds one). Read the logs.

**SQL:**
```sql
select b.id, b.created_at at time zone 'Asia/Kolkata' as created, b.created_tx is not null as indexed,
       s.id as slot, d.status, d.reason_tag, d.reason,
       jsonb_array_length(coalesce(d.gate_result -> 'orders', '[]')) as orders,
       jsonb_array_length(coalesce(d.gate_result -> 'bigMoves', '[]')) as big_moves
from bots b
left join decisions d on d.bot_id = b.id
left join slots s on s.id = d.slot_id
where b.id = <botId> and (s.kind = 'debut' or s.id is null);
select asset, side, tx_hash from trades where bot_id = <botId> order by id;
```

**On-chain:** `cast call $BOT_REGISTRY_ADDRESS "nextBotId()(uint256)" --rpc-url $RPC` is one above the new id. `portfolios(<botId>)` shows `init = true`. After a BUY the cash is below `107800000000` (START_CASH_E8) and `holdings(<botId>)` is non-zero.

**App:** `/bot/<botId>` lists the trade with an explorer link. `GET /api/v1/bots/<botId>/record` has a non-empty `trades`.

**If it fails:**
- Debut `held` / `skipped_stale` because no asset was fresh. This is expected: the debut offers only fresh assets (#219 item 18). The first trade comes at the next scheduled slot with a fresh feed. There is no re-debut path (master plan D7).
- `debut.failed` three times. The bot waits for the next scheduled slot. Send the `error` label to Gokul or Claude. Never send a trade by hand.
- A bot older than 10 min that never debuted (for example, the worker was down) also just waits for its next slot.

### 9.3 Season close, trust commit and next season open (S0: Sat Nov 28 21:30 IST, S1 opens Sun Nov 29 00:00)

Timeline from the code (`seasons/index.ts`, `season/close.ts`, `seasons/checks.ts`):
1. **21:00–21:15** last slot of the season and its retries. Daily Call settles run from 21:00 (9.4).
2. **21:30** `season_close`: `seasons.closing` with `season: 0`. Then, for the closing season: results and battle ranks; trust scores, and `commitScores` if the rules are published (`season.scores_committed`, or `season.no_trust_scores` / `season.trust_rules_unpublished`); the replay file is built and checked (`season.replay_failed` if it doesn't verify), uploaded as `season-0.jsonl`, then `closeSeason`: **`season.closed`** with `root`, `lines` and `uri`. Then challenges (`challenge.settled` / `challenge.expired`), then v2 proposals (`v2.proposed` per bot). Last, `scheduler.job_done` with `job: season_close`. A failed close is tried 4 times, 5 min apart (until about 21:50), then `scheduler.job_failed`. A Wave A PR (A1) may add retries every 15 min until 23:15. Check `apps/worker/src/scheduler/jobs.ts` on `main` before the night.
3. **21:35** `recap` (9.5).
4. After `season.closed`, the indexer reads the `SeasonClosed` event and the DB row becomes `closed`.
5. **00:00** `season_open`: **`seasons.opened`** with `season: 1`. If S0 is not closed on-chain yet, it logs `seasons.previous_not_closed` and opens nothing.

**/healthz:** `jobs.season_close.lastRun` at about 21:30 without `problem`. Then `jobs.season_open.lastRun` after 00:00 without `problem`. `season_close failed` or `season_open failed` in `reasons` means a failure.

**SQL:**
```sql
select id, status, starts_at at time zone 'Asia/Kolkata' as opens, ends_at at time zone 'Asia/Kolkata' as closes,
       data_root, data_uri, root_tx, trust_rules_version, scores_root, scores_tx
from seasons where id between 0 and 2 order by id;
select count(*) as bots, count(battle_rank) as ranked from season_results where season_id = 0;
select count(*) as scored, count(*) filter (where provisional) as provisional from trust_scores where season_id = 0;
select status, count(*) from challenges where season_id = 0 group by status;
select bot_id, version, max_per_coin_bps, max_trades_per_day from bot_versions
where source = 'season_v2' and committed_tx is null order by bot_id;           -- v2 proposals waiting for the owner
```
Expect S0 `closed` with `data_root`, `data_uri` and `root_tx` set, and S1 `open`. S0 is hidden from the public boards, results and trust views (`site_*`), so `/leaderboards` stays empty until S1 results exist. That is intended (#219).

**On-chain:**
```bash
cast call $SEASON_LEDGER_ADDRESS "seasonState(uint32)(uint8)" 0 --rpc-url $RPC                        # 2 = CLOSED
cast call $SEASON_LEDGER_ADDRESS "seasons(uint32)(uint64,uint64,bytes32,string,bool)" 0 --rpc-url $RPC  # start, end, dataRoot, dataURI, closed
cast call $TRUST_REGISTRY_ADDRESS "scoresRoot(uint32)(bytes32)" 0 --rpc-url $RPC                       # non-zero once scores are committed
cast call $TRUST_REGISTRY_ADDRESS "rulesVersionOf(uint32)(bytes32)" 0 --rpc-url $RPC                   # trust-v1-sprint, as bytes32
# after 00:00
cast call $SEASON_LEDGER_ADDRESS "nextSeason()(uint32)" --rpc-url $RPC                                 # 2 once S1 is open
cast call $SEASON_LEDGER_ADDRESS "seasons(uint32)(uint64,uint64,bytes32,string,bool)" 1 --rpc-url $RPC  # 1795890600, 1796054400 (Nov 29 00:00 → Nov 30 21:30 IST)
```
Then replay it (D6): `pnpm --filter @botfolio/replay build && pnpm replay 0 --ledger $SEASON_LEDGER_ADDRESS`. Exit code 0 means the root and every trade match. A mismatch is a P0, to fix before the S1 close.

**If it fails.** Find the first failing step in the logs, then:

| What you see | Do |
|---|---|
| `season.close_not_configured` with `needs` | A missing env variable (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INDEXER_START_BLOCK`, an address). Set it in Render and restart. The close runs again at start. |
| `scheduler.job_failed` for `season_close`, with an RPC or gas label | Committer balance (section 5), RPC (section 4). Then **restart the worker** (section 1). `season_close` and `season_open` both run at every start, so a restart is the first retry. Restart after 21:20, never inside the 21:00 slot window. |
| `season.replay_failed` | The file doesn't verify, so nothing was committed. **Do not close by hand.** This is a code bug: send the `findings` to Gokul or Claude. |
| `seasons.previous_not_closed` at 00:00 | S0 isn't closed on-chain yet. Fix the close first. A restart after the close succeeds also opens S1 (season_open runs at start). Otherwise the next automatic open is at 00:00 the next day, which costs S1 a day. |
| `season.closed` logged but `seasonState(0)` still 1 | An RPC lag. Wait a minute and check again on rpc4. |
| `season.trust_rules_unpublished` | Not expected: both versions were published Nov 26 (section 8). The data root still closes. The next close run commits the scores. |
| `season.scores_locked` | The chain already has a different root for a closed season. Leave it, and tell Gokul. A locked root can't be replaced (#219 item 4). |

**Manual fallback, only for a close whose replay file is uploaded but whose `closeSeason` tx keeps failing** (for example, after the restart, past about 23:00). Who: the person holding the committer key backup (`docs/deploy.md` step 1, password manager). **UNVERIFIED**: never run on mainnet.
1. Check that the file is public and verifies: `pnpm replay https://<SUPABASE_URL>/storage/v1/object/public/replay/season-0.jsonl --offline`. Exit 0, and note the `root 0x…` it prints. `SUPABASE_URL` is the public project URL, the same as `NEXT_PUBLIC_SUPABASE_URL`.
2. Import the committer key into a Foundry keystore on your own machine (`cast wallet import botfolio-committer --interactive`). It never goes into a chat, a file or a commit.
3. Dry run. The script checks that the season is open, that its end has passed, and that the root and URI are set. Without `--broadcast` it sends nothing:
   ```bash
   SEASON=0 DATA_ROOT=<root> DATA_URI=<the https URL from step 1> \
     forge script script/Admin.s.sol:CloseSeason --rpc-url $RPC --account botfolio-committer --sender 0xd27710cB6166560fe86d0aE4Ad412904F7f15D45
   ```
4. Send it. Add `--broadcast` to the same command. If forge's own gas estimate comes out bogus on QIE (#339: about 21k), send it with an explicit limit instead. closeSeason measured 167,259 gas (`docs/gas.md`):
   `cast send $SEASON_LEDGER_ADDRESS "closeSeason(uint32,bytes32,string)" 0 <root> <uri> --gas-limit 400000 --account botfolio-committer --rpc-url $RPC`
   The worker's daily_call_settle uses the same key from 21:00 to 23:50, every 10 min. Send between two runs (for example at :05) so the nonces don't collide. If they collide, the worker's tx fails and is retried.
5. Restart the worker. Its close run sees the season closed on-chain, then commits the trust scores and settles the challenges, and its open run opens S1 once it is past 00:00.

**Manual open fallback** (S1 not open after 00:20 even though S0 is closed, and a restart didn't help). The times must be the `seasons` row's: S1 is 1795890600 → 1796054400.
```bash
SEASON=1 SEASON_START=1795890600 SEASON_END=1796054400 \
  forge script script/Admin.s.sol:OpenSeason --rpc-url $RPC --account botfolio-committer --sender 0xd27710cB6166560fe86d0aE4Ad412904F7f15D45   # add --broadcast to send
```
(openSeason measured 56,548 gas; with `cast send` use `--gas-limit 150000`.) `launch-admin.sh` is not the tool for this: it covers only `publishRules` and the house bots (admin key), and both are done. There is no manual `commitScores` script. A closed season with no scores root is picked up again by the next `season_close` run.

Log every manual tx in `docs/decisions.md` with its hash.

### 9.4 Daily Call settle (21:00, then every 10 min to 23:50 IST, then once at 09:00 the next day)

It needs at least one call made that IST day (`daily_calls.call_tx` set). With none, the job does nothing and logs only `scheduler.job_done`.

**Logs:** `daily_call.settles_late` with `day` and `waiting` (no fresh BTC round from 21:00 yet; normal, it tries again in 10 min), then `daily_call.settled` with `day`, `bots` and `round`.

**SQL:**
```sql
select bot_id, day, user_up, bot_up, call_tx is not null as called, settle_tx, settle_round, user_correct, bot_correct
from daily_calls where day = <IST day> order by bot_id;
```
`user_correct` and `bot_correct` stay null after a settle when the price didn't change (no winner).

**On-chain:**
```bash
cast call $DAILY_CALL_ADDRESS "calls(uint256,uint32)(bool,bool,int256,uint80,uint64,bool,bool,bool)" <botId> <IST day> --rpc-url $RPC
# userUp, botUp, priceAtCall, roundAtCall, calledAt, settled, userCorrect, botCorrect
```

**If it fails:** `scheduler.job_failed` with `job: daily_call_settle` points to the committer balance (section 5) or the RPC (section 4). The 09:00 retry is the last automatic one. From 21:00 the next day the contract voids that day's settle for good (`SETTLE_WINDOW`, `docs/decisions.md` Nov 26). Manual fallback before then, committer key, **UNVERIFIED**: `cast send $DAILY_CALL_ADDRESS "settle(uint256[],uint32)" "[<botId>,...]" <day> --gas-limit 300000 --account botfolio-committer --rpc-url $RPC`. Only send it when `btc.updatedAt` is from 21:00 that day or later. Otherwise the contract skips it and the gas is wasted.

### 9.5 Recap and cards (recap 21:35 IST; trade and roast cards within about a minute)

**Logs:** the card sweeper runs every 60 s and logs `cards.trade` / `cards.roast` with `made` when it writes any, or `cards.sweep_failed`. At 21:35, `cards.recap` with `day` and `made`, then `scheduler.job_done` with `job: recap`. If `/healthz` `jobs.recap.state` is `not_started`, `PAPER_LEDGER_ADDRESS` is missing.

**SQL:**
```sql
select id, kind, bot_id, created_at at time zone 'Asia/Kolkata' as made from cards order by created_at desc limit 20;
```
Expect one `recap-<botId>-<day>` per active raised bot that has a mark, and a `trade` card after a bot's first trade.

**App:** open `/card/<id>` and `/api/card/<id>` for one real id. **Known:** the live-mode card page crashes on a real card (#105, master plan A8), and unfurls still use mocks (#109, A9). Check whether those PRs are merged before you share a card. Also known: during S0, recap cards can store a hidden-S0 rank and trust score (bug intake, Nov 27). Don't share S0 recap cards publicly.

**If it fails:** `scheduler.job_failed` with `job: recap` is a DB or chain read. Cards are derived data and safe to rebuild. The next sweep or the next 21:35 run writes the missing ones (ids come from their subject, so reruns don't make duplicates).

### 9.6 Challenges (user-signed create and accept; settled at the season close)

**Logs:** `relay.submitted` with selector `0xeffab51d` (`Challenges.create`) or `0x9d14cb64` (`accept`). At the close of that season (9.3): `challenge.settled` with `season`, `code` and `winner`; `challenge.expired` (never accepted); or `challenge.not_on_chain` (a DB row the chain doesn't know).

**SQL:**
```sql
select code, season_id, challenger_bot, opponent_bot, status, winner_bot, create_tx, accept_tx
from challenges order by season_id desc, code;
```

**On-chain:**
```bash
cast call $CHALLENGES_ADDRESS "challenges(bytes32)(uint256,uint256,uint32,uint8)" <code> --rpc-url $RPC   # challenger, opponent, season, status
cast call $CHALLENGES_ADDRESS "openCount(uint256)(uint8)" <botId> --rpc-url $RPC                          # at most 10 open per bot
```

**Known:** from the 21:30 close to the 00:00 open, "Challenge a friend" is refused (`WOULD_REVERT`, "That season can't be joined any more"), because the app still names the closed season (bug intake, Nov 27). Tell users to try again after 00:00. Challenges are settled only at a close, so S0's first ones settle on Sat Nov 28 at about 21:30.

**If it fails:** settle and expire run inside the close and are retried by every later close run while a challenge is still `open` or `accepted`. A `scheduler.job_failed` there doesn't undo the data root. Send the `code` to Gokul or Claude.

### 9.7 Big moves (Allow / Shrink / Block within 2 h; sweep every 10 min)

A buy that would put 30 % or more in one asset, or a sell of 50 % or more of a holding, is held for the owner (SPEC §6.4).

**Logs:** at the slot, `runner.decided` with `bigMoves > 0`. When the owner allows it: `relay.submitted` with selector `0x0f485a11` (`PaperLedger.executeApproved`). Every 10 min the sweep shrinks or expires what passed its deadline: `big_moves.swept` with `shrunk` and `expired`. Failures: `big_moves.batch_failed`, `big_moves.bot_failed`, `big_moves.order_mismatch`.

**SQL:**
```sql
select id, bot_id, asset, side, bps, status, deadline at time zone 'Asia/Kolkata' as deadline, user_tx,
       '0x' || encode(order_id, 'hex') as order_id
from big_moves order by id desc limit 10;
```
`status` moves from `pending` to `approved` (the owner allowed it; `user_tx` set), `shrunk` (the sweep sent the safe size), `blocked`, or `expired`.

**On-chain, the double-execution guard:**
```bash
cast call $PAPER_LEDGER_ADDRESS "usedOrder(bytes32)(bool)" <order_id> --rpc-url $RPC   # true once executed, by either path
```
Exactly one `Trade` event should exist for that `decisionId` and `actionIndex`. An allowed move also emits `ApprovedTrade` with the owner's address. If both the owner's tx and the sweep were sent, the second is skipped as `USED` (an `OrderSkipped` with reason 4, or a reverted `executeApproved` with `OrderRejected(4)`).

**Known limits (accepted for the hackathon, master plan D5 and D6):** an expired cumulative SELL can end above 50 % in total. A second big move in one decision is dropped with no F1 penalty. A big move from the 21:00 slot on a close night can land after the season's root is committed (bug intake, Nov 27).

**If it fails:** `big_moves.batch_failed` points to the runner balance or the RPC, and the next sweep retries it. A pending move whose owner never acts is shrunk or expired by the sweep. Don't send it by hand.

## 10. On-call, Dec 1–7 (demo week and the switch to weekly seasons)

Calendar from `packages/db/seeds/seasons.sql`. Every day also runs the four slots (9.1), the Daily Call settle from 21:00 (9.4) and the recap at 21:35 (9.5). Fill in the names by Nov 30 (#169, master plan H24). The **UNVERIFIED** cells stay that way until the hackathon's demo-day schedule is known.

| Day (IST) | Events | Primary | Backup | What to check |
|---|---|---|---|---|
| Tue Dec 1 | 00:00 S2 opens. 04:29 submission deadline passes (we submit Nov 30 around 22:00) | TBD | TBD | `nextSeason() = 3`, `seasonState(2) = 1`. The 09:00 slot (9.1). The submission confirmation is saved |
| Wed Dec 2 | **21:30 S2 closes** | TBD | TBD | 9.3 for S2, then `pnpm replay 2 --ledger $SEASON_LEDGER_ADDRESS`. Screenshots of the S1 and S2 boards and `/stats` (user-signed first) for the demo |
| Thu Dec 3 | 00:00 S3 opens | TBD | TBD | `nextSeason() = 4` |
| Fri Dec 4 | **21:30 S3 closes** | TBD | TBD | 9.3 for S3. The S3 results are in the demo if we present after this |
| Sat Dec 5 | 00:00 S4 opens. Demo presentation (day **UNVERIFIED**) | TBD | TBD | `nextSeason() = 5`. Before presenting, `/healthz` is `ok` or every reason is understood, and the feeds are fresh |
| Sun Dec 6 | **21:30 S4 closes** (last 2-day sprint) | TBD | TBD | 9.3 for S4. Section 8 checks are done before today |
| Mon Dec 7 | **00:00 S5 opens, the first weekly season** (closes Sun Dec 13 21:30). Start of the weekly `/stats` report (#180) | TBD | TBD | `seasons.opened` with `season: 5`, and `nextSeason() = 6` (section 8). From now on the daily 21:30 close does nothing until Dec 13 |

Every day the on-call person:
- reads `/healthz` after the 09:00 slot: `lastSlotRun` is today's 09:00, and every entry in `reasons` is understood;
- watches the alert channel (section 5b) and tops up any wallet below 2 QIE (section 5);
- doesn't merge worker PRs inside the no-merge windows ([`release.md`](release.md) section 8). Close nights are 20:55–00:20;
- writes every manual action in `docs/decisions.md`.
