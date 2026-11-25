# Rollback procedure

How to undo a bad release of the web app (Vercel), the worker (Render) or the contracts (a switch to new addresses). For live incidents that need no rollback (stale oracle, LLM down, RPC down, empty wallet), see [`runbook.md`](runbook.md).

Steps marked **UNVERIFIED** were written from the code and the docs, not tried on the live service. Never paste a key, `DATABASE_URL` or any other secret into a chat, an issue or this file.

## First: roll back or fix forward?

- **Roll back** when the last deploy broke something users touch (the newcomer path, relays, slots) and the cause isn't obvious within about 15 minutes.
- **Fix forward** when the fix is one small, clear PR.
- Either way, `main` must end up good. After a rollback, revert the bad PR on `main` with `git revert -m 1 <merge commit>` on a new branch and merge it through a PR. Otherwise the next merge redeploys the bad code.
- Write each rollback in `docs/decisions.md`: date, what was rolled back, why, who.

| Part | Who |
|---|---|
| Web (Vercel) | Whoever has Vercel access. **UNVERIFIED**: list the names here |
| Worker (Render) | Gokul, or whoever has Render access |
| Contract-address switch | Whole team decides. The deploy is run by the person with the deployer signer (#25). Roles by the admin key holder |

## 1. Web: Vercel instant rollback

**Do:**
1. Vercel dashboard → the BotFolio project → **Deployments**. Find the last production deployment that worked.
2. Open its menu → **Instant Rollback**, and confirm. **UNVERIFIED**: menu wording. The CLI equivalent is `vercel rollback <deployment-url>`, also **UNVERIFIED** for our team account.
3. Check on a real phone: the landing page loads, the footer says "Play money. Not investment advice. No prizes.", and the 30 s newcomer path gets to a bot.

**Know:**
- A rollback serves the old build as it is, so it also brings back the old `NEXT_PUBLIC_*` values. Next.js inlines them into the browser bundle at build time (`apps/web/lib/config.ts`). The ones the app reads today: `NEXT_PUBLIC_RELAY_URL`, `NEXT_PUBLIC_FORWARDER_ADDRESS`, `NEXT_PUBLIC_BOT_REGISTRY_ADDRESS`.
- So a rollback does **not** undo an env var change. To undo one, set the old value in Vercel → Settings → Environment Variables, then **Redeploy** the current deployment. **UNVERIFIED**: menu wording.
- After an instant rollback, Vercel may stop promoting new production deploys automatically until someone undoes the rollback or promotes a deployment by hand. **UNVERIFIED** on our plan. Check this before assuming the revert PR is live.
- The web has no database migrations of its own, so a web rollback never touches data.

## 2. Worker: Render previous deploy

**Do:**
1. If auto-deploy is on, turn it off for now: Render → the service → Settings → **Auto-Deploy** → No. **UNVERIFIED**: setting name. Then the revert PR can't race the rollback.
2. Render → the service → **Events**. Find the last deploy that worked and choose **Rollback**. **UNVERIFIED**: menu wording.
3. Watch the logs for `[worker] listening on :<port> · chain 1990 · ...` and `{"event":"scheduler.started",...}`.
4. Check `GET <RENDER_SERVICE_URL>/healthz`: `status` and `reasons` (see `runbook.md`). Then watch the next slot for `{"event":"scheduler.slot_done",...}`.
5. Merge the revert PR on `main`, then turn auto-deploy back on.

**Why it is safe to roll back the worker at any time:**
- On `SIGTERM` the worker lets a broadcast and an indexer batch in progress finish, then exits (10 s limit).
- Every job is idempotent. A slot rerun inside its 20-minute window never decides a bot twice or sends an order twice. Season open and close follow the chain.
- The relayer reloads relays submitted in the last hour from `relay_log`.

**Know:**
- **Database migrations are forward-only** (`packages/db/README.md`). Rolling the worker back does not roll the schema back. Before rolling back past a deploy that added a migration in `packages/db/migrations/`, check that the old code still works with the new schema. If it doesn't, fix forward. Today there is only `0001_init.sql`.
- **Env vars:** **UNVERIFIED** whether a Render rollback also restores the env vars of that deploy. Assume it doesn't. If the bad release also changed env vars, set the old values by hand and restart.
- Rolling back to a build older than the deployed contracts' ABIs can break reads. Don't roll back across a contract-address switch (section 3).

## 3. Contract-address switch

Use this only when a deployed contract has a bug that needs a redeploy. The contracts have no upgrade path and no pause, and the feeds and start cash are fixed at deploy (`packages/contracts/README.md`). A new deploy is a new set of seven addresses.

### What a switch means: write this down for users

- **Past records stay on the old contracts, for good.** Bots, versions, corrections, trades, seasons and Daily Calls already on-chain stay at the old addresses. Their tx links on `https://mainnet.qie.digital` keep working. Nothing moves over.
- **The new contracts start empty.** `BotRegistry.nextBotId` starts at 1 and `SeasonLedger.nextSeason()` at 0. Every user has to create their bot again.
- **The database can't hold both.** `bots.id` is the on-chain bot id (`packages/db/schema.sql`), so new bot 1 would collide with old bot 1. The new deployment needs an empty database. Keep the old one as a read-only archive.
- **Mid-season, the indexer needs a new start block.** `INDEXER_START_BLOCK` must be the new deploy block. The indexer refuses a start block later than the deploy (`indexer/resume.ts`).
- **Seasons restart on-chain.** On start the worker opens, in order, every season in `seasons` whose `starts_at` has passed, beginning from the new ledger's season 0 (`seasons/checks.ts`). Mid-season that opens S0 to the current season again in a burst of committer txs. **Open decision for the team**: keep that, or change the season rows in the new database before starting the worker. Log the choice in `docs/decisions.md`.

### Where the addresses live

There is no deployments file in the repo. The addresses are env vars only:

| Where | Vars |
|---|---|
| Render (worker) | `FORWARDER_ADDRESS`, `BOT_REGISTRY_ADDRESS`, `PAPER_LEDGER_ADDRESS`, `SEASON_LEDGER_ADDRESS`, `TRUST_REGISTRY_ADDRESS`, `DAILY_CALL_ADDRESS`, `CHALLENGES_ADDRESS`, `INDEXER_START_BLOCK` |
| Vercel (web) | `NEXT_PUBLIC_FORWARDER_ADDRESS`, `NEXT_PUBLIC_BOT_REGISTRY_ADDRESS`. SPEC §10 also lists `NEXT_PUBLIC_PAPER_LEDGER_ADDRESS`, `NEXT_PUBLIC_SEASON_LEDGER_ADDRESS`, `NEXT_PUBLIC_DAILY_CALL_ADDRESS`, `NEXT_PUBLIC_CHALLENGES_ADDRESS`. Set them too if the web reads them by then |

The worker's indexer starts only if all seven addresses are set, valid and different from each other.

### Do

1. **Decide.** The team agrees, and the decision goes in `docs/decisions.md` with the reason.
2. **Pause.** In Render set `RELAY_ENABLED=false` and remove `RUNNER_PRIVATE_KEY`, then restart. No user actions or trades go to the old contracts after this. See `runbook.md` section 7.
3. **Deploy.** The person with the deployer signer runs `script/Deploy.s.sol` (`packages/contracts/README.md`, issue #25) with the same `ADMIN_ADDRESS`, `RUNNER_ADDRESS`, `COMMITTER_ADDRESS` and `RELAYER_ADDRESS`. The script grants the roles. Write down the seven addresses it logs and the block of the first deploy tx.
4. **Publish trust rules** on the new `TrustScoreRegistry` (admin, `Admin.s.sol:PublishRules`). Without them the worker logs `season.trust_rules_unpublished` and commits no trust scores.
5. **New database.** Make a new empty Supabase project (or database). Apply `packages/db/migrations/` in order, then `packages/db/seeds/seasons.sql` (with any season change from the open decision above).
6. **Render env.** Set the seven address vars, `INDEXER_START_BLOCK` to the new deploy block, and `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the new database. Put `RUNNER_PRIVATE_KEY` back and set `RELAY_ENABLED=true`. Restart.
7. **Vercel env.** Set the `NEXT_PUBLIC_*_ADDRESS` vars (and the Supabase ones if the web uses them), then **Redeploy**. An instant rollback can't do this: the addresses are inlined at build time.
8. **Check.**
   - The logs show `[indexer] started {"startBlock":"<new deploy block>",...}`, not `[indexer] NOT started`.
   - `/healthz` has no `job not started` reasons.
   - On a real phone, create a bot. Its tx on the explorer goes to the new `BotForwarder` address.
   - The next slot logs `runner.batch_sent`.
9. **Tell users.** One line in the app and on social: the season restarted on new contracts, the old records stay on-chain at the old addresses, and they need to create their bot again.

### Switching back

The old contracts stay live with their roles, so switching back is the same steps with the old addresses, the old deploy block and the old database. Anything done on the new contracts in between stays there and isn't carried back.

## Staging drill

Issue #165 asks for this to be tried once on staging. Staging is the local mainnet fork ([`anvil-fork.md`](anvil-fork.md)): deploy twice onto the fork, point a local worker at the first set, then switch to the second with steps 2 to 8 of section 3. **Not done yet.** Write the date and the result here when it is.
