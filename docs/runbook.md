# Incident runbook

What to do when something breaks on the live service. Each section is symptom → check → fix → who. Rolling back a bad deploy is in [`rollback.md`](rollback.md).

Steps marked **UNVERIFIED** were written from the code and the docs, not tried on the live service. Never paste a key, `DATABASE_URL` or any other secret into a chat, an issue or this file.

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
| Admin cold key (role grants and revokes) | Holder of `ADMIN_ADDRESS`. **UNVERIFIED** who; write the name here after the deploy (#25) |
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
2. Long outage: switch provider. Set `LLM_PROVIDER=openai` and `OPENAI_API_KEY` (or `anthropic` and `ANTHROPIC_API_KEY`) in Render, and the model vars `LLM_MODEL_DECISION`, `LLM_MODEL_PERSONA`, `LLM_MODEL_V2` to that provider's model names. Then restart (section 1). Log the switch in `docs/decisions.md`. **UNVERIFIED**: the OpenAI and Anthropic clients have not run against the live decision schema.
3. Never set `LLM_PROVIDER=fake` in production. The runner refuses to start the slot job with it (`slot job not started: needs LLM_PROVIDER`).

### 3b. Key missing or wrong
**Symptom:** `/healthz` reason `slot job not started: needs XAI_API_KEY` (or the key for the chosen provider). Or every call fails with `http` status 401/403.

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
   If it returns zero, the admin key holder publishes it with `script/Admin.s.sol:PublishRules` and `RULES_VERSION=trust-v1` ([`packages/contracts/README.md`](../packages/contracts/README.md), "Publish trust rules"). Use the same `docs/trust-rules.md` bytes, URI and hash as `trust-v1-sprint`: that doc defines both versions. **UNVERIFIED**: whether `trust-v1-sprint` and `trust-v1` are already published on mainnet.

Without step 2, S5's close still commits the data root, but not the trust scores (`season.trust_rules_unpublished` in the logs). Publishing later is enough: the next close run commits them.

On the day, check the logs:
- Sun Dec 6 21:30 IST: S4 goes `closing`, then `closed` once its `SeasonClosed` event is indexed.
- Mon Dec 7 00:00 IST: `seasons.opened` with `season: 5`. Check on-chain with `cast call $SEASON_LEDGER_ADDRESS "nextSeason()(uint32)"`, which should return 6.
- From then on, the daily 21:30 close check does nothing until Sun Dec 13 21:30.

Known limit: S18 is the last seeded row. From Mon Mar 15 2027 00:00 IST, `season_open` logs `seasons.no_next_row` each day (no job failure, #313) and opens nothing until rows from S19 on are added to the seed.

**Who:** Gokul for the database check. The admin key holder for `publishRules`.
