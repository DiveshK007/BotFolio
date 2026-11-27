# Release checklist

Run this before every production deploy (Vercel web, Render worker). Tick each line in the PR or in the deploy note. Anything you could not check yourself: write `UNVERIFIED` next to it, do not tick it.

Wording rules apply to everything you read or write here: never "trustless" or "decentralised". Say "settled against QIE's official mainnet oracle". Every page carries "Play money. Not investment advice. No prizes."

Related: [`runbook.md`](runbook.md) (incidents), [`rollback.md`](rollback.md) (undo a bad deploy), [`public-api.md`](public-api.md), [`anvil-fork.md`](anvil-fork.md) (local mainnet fork).

## 1. Before you merge

CI on the PR must be green. What each workflow runs:

| Workflow | Runs | Triggers on changes to |
|---|---|---|
| `.github/workflows/web.yml` | typecheck, lint, test, build for `apps/web` | web paths |
| `.github/workflows/worker.yml` | typecheck, unit tests, build for `apps/worker`, `packages/db`, `packages/llm`, `packages/shared`, `scripts/replay` (no lint step) | those paths |
| `.github/workflows/contracts.yml` | `forge fmt --check`, `forge build --sizes`, `forge test -vvv`, `script/dry-run.sh`, Slither | `packages/contracts` |
| `.github/workflows/audit.yml` | `pnpm audit --audit-level high`, weekly (Mon 03:30 UTC) | schedule |

Locally, from the repo root, the same checks: `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint` (the worker has no lint script; `--if-present` skips it). For contract changes: `forge test` on a mainnet fork (`anvil-fork.md`).

- [ ] CI green on the PR (web, worker, contracts as relevant)
- [ ] `pnpm audit --audit-level high` has no open findings, or each is logged in `docs/decisions.md`
- [ ] No frozen file changed outside an announced PR: `packages/shared/*`, `packages/contracts/abi/*`, `packages/db/schema.sql`
- [ ] No secret in the diff, and none in any `NEXT_PUBLIC_*` variable
- [ ] Merged **outside the no-merge windows** in section 8. Every merge to `main` redeploys the worker, docs-only PRs included

## 2. Environment

Names come from `.env.example`. Never write values here or in chat; check them in the Vercel and Render dashboards only.

Render (worker):
- [ ] `WEB_ORIGINS` includes the exact Vercel production origin (comma-separated, no wildcards); if empty, `APP_URL` is used. Browser calls fail CORS otherwise
- [ ] `ALERT_WEBHOOK_URL` set (https Slack or Discord style); `LOW_BALANCE_ALERT_QIE` set
- [ ] Contract addresses: `FORWARDER_ADDRESS`, `BOT_REGISTRY_ADDRESS`, `PAPER_LEDGER_ADDRESS`, `SEASON_LEDGER_ADDRESS`, `TRUST_REGISTRY_ADDRESS`, `DAILY_CALL_ADDRESS`, `CHALLENGES_ADDRESS`
- [ ] `RELAYER_PRIVATE_KEY`, `RUNNER_PRIVATE_KEY`, `COMMITTER_PRIVATE_KEY`, `RELAY_JWT_SECRET`, `INTERNAL_CRON_SECRET` present; the three hot wallets have QIE for gas (`runbook.md` section 5)
- [ ] `QIE_CHAIN_ID=1990`, `QIE_RPC_URLS` lists the rpc1 to rpc5 mainnet endpoints (failover), not a local fork URL
- [ ] `LLM_PROVIDER` and its key set; `LLM_MONTHLY_BUDGET_USD` set

Vercel (web):
- [ ] `NEXT_PUBLIC_QIE_CHAIN_ID=1990`
- [ ] `NEXT_PUBLIC_FORWARDER_ADDRESS`, `NEXT_PUBLIC_BOT_REGISTRY_ADDRESS`, `NEXT_PUBLIC_PAPER_LEDGER_ADDRESS`, `NEXT_PUBLIC_SEASON_LEDGER_ADDRESS`, `NEXT_PUBLIC_TRUST_REGISTRY_ADDRESS`, `NEXT_PUBLIC_DAILY_CALL_ADDRESS`, `NEXT_PUBLIC_CHALLENGES_ADDRESS` all match the Render addresses and the verified contracts on `https://mainnet.qie.digital`
- [ ] `NEXT_PUBLIC_RELAY_URL` points at the Render service; `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_PRIVY_APP_ID` set
- [ ] `NEXT_PUBLIC_QIE_RPC_URLS` empty (= rpc3, rpc4, rpc5, rpc1, rpc2) or a comma list of mainnet RPCs, not a local fork URL
- [ ] The Render service has the same `NEXT_PUBLIC_PRIVY_APP_ID` plus `PRIVY_APP_SECRET`, `SIWE_DOMAIN` = the site's host (e.g. `botfolio.example`, no scheme) and `WEB_ORIGINS`/`APP_URL` = the site's origin. SIWE only works on that one host, so QIE Wallet sign-in fails on Vercel preview URLs
- [ ] Privy dashboard: the site's origin is an allowed origin, passkey login is on, Ethereum embedded wallets are on (see `apps/web/README.md`)
- [ ] Render health check path is `/healthz` (**UNVERIFIED**, see `runbook.md`)

## 3. After deploy: worker smoke checks

Use the Render service URL (`RENDER_SERVICE_URL`). Public GET routes need no sign-in:

- [ ] `GET /healthz` returns 200; `status` is `ok`, or every entry in `reasons` is understood (`runbook.md`, "Where to look first")
- [ ] `GET /status` returns the public status (drives the site banner)
- [ ] `GET /leaderboards?season=<n>` returns the four boards
- [ ] `GET /bot-page?bot=<botId>` returns a real bot
- [ ] `GET /stats` shows user-signed and system txs apart
- [ ] `GET /trust/proof?season=<n>&bot=<botId>` returns a score and proof
- [ ] From the Vercel origin in a browser, one of the above passes CORS (no console error)

Signed-in routes cannot be curl-checked without a login. Exercise them through the app flows in section 5: `POST /relay`, `POST /persona`, `POST /big-moves`, `POST /daily-call`.

## 4. After deploy: web smoke checks

Open each page on the production URL at 360 px width. On every page: no console errors, the footer reads "Play money. Not investment advice. No prizes.", and the status banner is absent when `/status` is clean and appears when prices are delayed or bots are resting.

- [ ] `/` landing loads, one clear create button
- [ ] `/create` form renders and reaches the sentence step
- [ ] `/about` loads
- [ ] `/terms` and `/privacy` load
- [ ] `/proof` loads and shows contract addresses that match section 2
- [ ] `/leaderboards` shows four boards for the current season
- [ ] `/stats` loads; user-signed and system numbers are separate
- [ ] `/bot/<botId>` for a real bot: record, trades, trust score, Verify-on-QIE links open on `mainnet.qie.digital`
- [ ] `/api/v1/bots/<id>/record` returns JSON matching `public-api.md`
- [ ] Share card routes under `apps/web/app/api/card` and `/card/<cardId>`: one real card per kind renders and unfurls in WhatsApp and X. **UNVERIFIED** on production with a real (not mock) card until #105 and #109 are closed

## 5. Regression flows (real phone, real mainnet)

Needs a phone (iOS Safari or Android Chrome) and a fresh passkey wallet. Users never pay gas.

- [ ] **30 s newcomer path (CLAUDE.md rule):** landing to first trade in 30 s or less. Time it with a stopwatch; note the result in the deploy note
- [ ] **Create:** one sentence in `/create`, accept terms, passkey, persona shown, bot created; the `createBot` tx on the explorer has the user as `_msgSender`
- [ ] **First trade:** debut trade appears on the bot page with an explorer link and price age label
- [ ] **Big move:** a pending big move shows, Approve executes once, a second approve does not double execute, an ignored one expires or falls back
- [ ] **Daily call:** open the Daily Call sheet, place a call, see the settled result after the day's settle job
- [ ] **Season close:** at the close time check `season_close` ran, final boards and trust scores are committed, v2 diff offered; compare against `pnpm replay` output
- [ ] **Cards:** roast, recap, evolution, challenge cards render with the play money line (**UNVERIFIED** for real cards in production, #105)
- [ ] **Stale oracle:** if a feed is stale the batch holds that asset and does not revert (`runbook.md` section 2)

## 6. If something is wrong

Roll back first, then diagnose. See [`rollback.md`](rollback.md) for Vercel, Render and the contract-address switch, and [`runbook.md`](runbook.md) for incidents. Log real decisions in `docs/decisions.md`.

## 7. Code freeze (from Sun Nov 29)

Calendar (`packages/db/seeds/seasons.sql`, SPEC 12.3, updated Nov 27): S0, the hidden test season, closes Sat Nov 28 21:30 IST. S1 opens Sun Nov 29 00:00, and the freeze starts then. S1 closes Mon Nov 30 21:30. We submit Mon Nov 30 around 22:00 IST (fallback 23:00); the hard deadline is 04:29 IST Dec 1. S2 opens Dec 1 00:00 and closes Dec 2 21:30, after the deadline. From the freeze on, `main` is the submission. Only fixes go in, and no worker merge after Mon Nov 30 12:55 except an emergency.

- [ ] **Announce** in the team chat before the freeze starts, with the exact freeze time and who may merge
- [ ] **Allowed:** PRs labelled `bug`, plus `documentation` PRs for README, architecture, trust-rules, replay guide (SPEC 13). Nothing else
- [ ] **Not allowed:** new features, refactors, dependency bumps (close or leave open the Dependabot PRs), frozen interface changes, contract redeploys that move addresses
- [ ] Each fix PR says what broke, links the issue, and runs the full checklist above for the part it touches
- [ ] Workstream owner reviews as usual; a second pair of eyes on anything under `apps/worker` or `packages/contracts`
- [ ] Before merging in the freeze, ask: can this break the live S1 season, its 21:30 Nov 30 close, or the demo path? If yes, hold it until after submission
- [ ] After each freeze merge, run sections 3 and 4 on production
- [ ] Final: run the whole checklist once on the commit that is submitted, and tag it `v1.0-submission`. Check the README works from a fresh clone (SPEC 12.3, Nov 29 gate)

Rollback if a freeze merge breaks production: [`rollback.md`](rollback.md).

## 8. No-merge windows (worker auto-deploy)

`render.yaml` has `autoDeploy: true` and, since #375, a `buildFilter`: only merges that touch `apps/worker/**` (not its tests), `packages/**`, the root install files or `render.yaml` rebuild and restart the worker. Docs-only and web-only merges don't. **UNVERIFIED** until the first docs-only merge after #375 leaves `/healthz` `startedAt` unchanged, since Render applies blueprint changes only when the blueprint syncs. Until that check passes, treat every merge as a restart. A restart is safe by design (`runbook.md` section 1), but one in the middle of a slot or a close costs a retry or a whole night. So **no PR is merged** in these windows, every day (IST):

| Window (IST) | What runs then |
|---|---|
| 08:55–09:25 | 09:00 slot and its +5 / +10 / +15 min stale retries; the next-day Daily Call settle retry at 09:00 |
| 12:55–13:25 | 13:00 slot and retries |
| 16:55–17:25 | 17:00 slot and retries |
| **20:55–00:20** | 21:00 slot and retries, Daily Call settle (21:00 to 23:50), season close (21:30), recap (21:35), season open (00:00) |

- Once the filter is confirmed, the windows apply only to PRs that touch the worker's build paths. Docs and web-only PRs can merge at any time (Vercel still redeploys the site).
- Batch merges into about one deploy per open window. After each deploy, check `/healthz` (`startedAt` is new, `reasons` holds nothing new) and the boot alert, if it is set up.
- The season-close nights are the strictest: Sat Nov 28 (S0), Mon Nov 30 (S1), Wed Dec 2 (S2), Fri Dec 4 (S3), Sun Dec 6 (S4), and Mon Dec 7 around 00:00 (weekly S5 opens). The last Wave A worker merge is Sat Nov 28 20:50.
- An emergency fix inside a window is the on-call person's call. Write it in `docs/decisions.md` with the reason.
