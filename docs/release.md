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
- [ ] `GET /fx/usd-inr` returns a number (display only)
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
- [ ] Share card routes under `apps/web/app/api/card`: **UNVERIFIED**, that folder does not exist on `main` yet. When it ships, check one card per kind unfurls in WhatsApp and X

## 5. Regression flows (real phone, real mainnet)

Needs a phone (iOS Safari or Android Chrome) and a fresh passkey wallet. Users never pay gas.

- [ ] **30 s newcomer path (CLAUDE.md rule):** landing to first trade in 30 s or less. Time it with a stopwatch; note the result in the deploy note
- [ ] **Create:** one sentence in `/create`, accept terms, passkey, persona shown, bot created; the `createBot` tx on the explorer has the user as `_msgSender`
- [ ] **First trade:** debut trade appears on the bot page with an explorer link and price age label
- [ ] **Big move:** a pending big move shows, Approve executes once, a second approve does not double execute, an ignored one expires or falls back
- [ ] **Daily call:** open the Daily Call sheet, place a call, see the settled result after the day's settle job
- [ ] **Season close:** at the close time check `season_close` ran, final boards and trust scores are committed, v2 diff offered; compare against `pnpm replay` output
- [ ] **Cards:** roast, recap, evolution, challenge cards render with the play money line (**UNVERIFIED** until the card routes exist)
- [ ] **Stale oracle:** if a feed is stale the batch holds that asset and does not revert (`runbook.md` section 2)

## 6. If something is wrong

Roll back first, then diagnose. See [`rollback.md`](rollback.md) for Vercel, Render and the contract-address switch, and [`runbook.md`](runbook.md) for incidents. Log real decisions in `docs/decisions.md`.

## 7. Code freeze (from Sun Nov 29)

SPEC 12.3: S2 closes Nov 29 21:30, submission is Mon Nov 30 evening IST, with the night as buffer before 04:29 IST Dec 1. From the freeze on, `main` is the submission. Only fixes go in.

- [ ] **Announce** in the team chat before the freeze starts, with the exact freeze time and who may merge
- [ ] **Allowed:** PRs labelled `bug`, plus `documentation` PRs for README, architecture, trust-rules, replay guide (SPEC 13). Nothing else
- [ ] **Not allowed:** new features, refactors, dependency bumps (close or leave open the Dependabot PRs), frozen interface changes, contract redeploys that move addresses
- [ ] Each fix PR says what broke, links the issue, and runs the full checklist above for the part it touches
- [ ] Workstream owner reviews as usual; a second pair of eyes on anything under `apps/worker` or `packages/contracts`
- [ ] Before merging in the freeze, ask: can this break the live S3 season or the demo path? If yes, hold it until after submission
- [ ] After each freeze merge, run sections 3 and 4 on production
- [ ] Final: run the whole checklist once on the commit that is submitted, and tag it. Check the README works from a fresh clone (SPEC 12.3, Nov 29 gate)

Rollback if a freeze merge breaks production: [`rollback.md`](rollback.md).
