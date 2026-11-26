_Approved by the user Nov 27 2026 01:00 IST; executed by Claude overnight._

# BotFolio master plan (Nov 27 to Dec 7, 2026)

*Drafted Nov 27, ~01:30 IST. Nothing goes ahead until the user approves. Play money. Not investment advice. No prizes.*

---

## 1. Where things stand

**Live:** All 7 contracts are deployed and source-verified on QIE mainnet (chain 1990). All 28 of 28 role checks passed. Trust rules are published and the 3 house bots are seeded. The worker runs on the Render free plan, with UptimeRobot keeping it awake. Postgres is Supabase in Mumbai, with the schema and seasons seeded. The LLM is Claude Haiku 5.5 with a $4/month cap. The web app runs in live mode at https://bot-folio.vercel.app.

**Proven:**
- Passkey sign-up works on Android.
- The first real user bot (#4) was created with the user signing and the relayer paying gas.
- S0 opened on-chain (tx 0x5c7ea4bd…f853, 00:24 IST Nov 27) after the gas-estimate fix (#338, #340, #341).
- The QIE Wallet MCP and `.qie` reverse lookup work live. A lookup that returns a name was already checked on Nov 26 with qie.qie (decisions.md:34).

**Not proven (UNVERIFIED):**
- A successful debut trade: bot #4 has `trades: []`.
- The first scheduled slot (`lastSlotRun` is null).
- The Daily Call settle, season close, trust-score commit, S1 open, challenges and replay against mainnet data.
- Passkey sign-up on iPhone Safari.
- QIE Wallet `signTypedData_v4` on chain 1990.
- The timed 30 s newcomer path. The first Android passkey alone took about 60 s.

**Measured tonight:** at 01:20 IST all four crypto feeds were 52–82 min old against a 30 min limit. Only Gold was fresh, so many slots will skip and hold.

**Hard deadline:** **Dec 1, 04:29 IST** (Nov 30, 23:59 CET). **Our target is to submit Nov 30 around 22:00 IST.** We submit anyway by 23:00 IST, even if the S1 close fails.

**Squeeze points:**
- The team is also at Dev3pack Nov 27–29.
- Code freeze starts Sun Nov 29 (docs/release.md §7).
- The S0 close at Nov 28 21:30 is the only rehearsal before the S1 close, which lands about 7 h before the deadline.

---

## 2. Close list

**Close now**

| # | Evidence for the closing comment |
|---|---|
| 1 | Superseded. Interfaces are frozen and deployed, Privy passkey is live, and owners are listed in CLAUDE.md. Say that "assign every M1/M2 issue" was dropped (#34, #99, #100, #103, #129–#132, #175, #176 and #178 are unassigned). |
| 31 | README.md:204–216 lists all 7 contracts, their roles and explorer links, and they match deployments/1990.env. The explorer shows `is_verified=true` for all 7. |
| 134 | seasons.sql (S0–S18) runs through setup.sh, house bots through `house:seed`, and both are seeded live. Leaving out test bots was deliberate: they would inflate user metrics. |
| 130 | Vercel builds a preview per PR and production from main (bca20eb shows Vercel: success). State plainly that two review additions were **not** checked: the Privy preview-wildcard origin, and fork-PR env exposure. The repo is public, so check Vercel's fork protection setting. |
| 178 | Dropped. Every critical-path issue is closed except #76, which has its own issue. |
| 175 | Dropped. The work runs from labels and milestones. |
| 176 | Dropped. The #169 rota covers coordination. |

**Close after a short check**

| # | Check first | Who |
|---|---|---|
| 34 | Confirm the Singapore region on the Render dashboard (render.yaml:8 marks it UNVERIFIED) and set ALERT_WEBHOOK_URL. Note the decisions.md changes: Haiku instead of xAI, and the free plan plus UptimeRobot. | Divesh, 5 min |
| 100 | Claude writes the MCP tool list and the Nov 26 and Nov 27 lookup results into docs/qie-components.md (part of A12). | Claude, 10 min |
| 219 | After A11 merges (copy fixes and Granny set to 50/50) and TRUSTED_PROXY_HOPS is confirmed from a real Render header. This does **not** depend on #129. | Claude + Divesh |
| 189 | After A12 and the #99 result are recorded. | Claude |
| 163 | After the webhook test alert arrives and the 09:00 slot shows `scheduler.slot_done` plus `runner.batch_sent` with a tx hash. | Both |

---

## 3. Human-only checklist (in order)

Secrets go into Render or Vercel env only. Never paste them into chat or an issue.

| # | By (IST) | Task | Issue | Owner |
|---|---|---|---|---|
| H1 | Nov 27 08:55–09:30 | Watch the first scheduled slot: `/healthz` jobs.slot and lastSlotRun, the runner 0x33b6…A181 on the explorer, and /bot/4. If it fails, send Claude the Render logs. | 76, 163 | Divesh |
| H2 | Nov 27 12:00 | Confirm the team is registered on hackathon.qie.digital with the team QIE wallet address, and save proof. This is the only true blocker. | 96 | Divesh |
| H3 | Nov 27 12:00 | **Run /ultrareview** (see §5). | — | User |
| H4 | Nov 27 12:00 | Create a Discord webhook, set ALERT_WEBHOOK_URL in Render, run the test in runbook §5b, and turn on phone notifications for on-call. | 163, 169, 157 | Divesh |
| H5 | Nov 27 12:00 | Make the decisions in §8, starting with D2, D3, D7 and D8. | — | User |
| H6 | Nov 27 14:00 | Anon-key RLS check: curl `/rest/v1/{users,relay_log,big_moves,daily_calls}` with the anon key and expect 401 or 42501, while `site_bots` should return 200. Paste the results into the issue. | 154 | Divesh |
| H7 | Nov 27 14:00 | Decide who covers BotFolio on each Dev3pack day. Name one person for Nov 28 21:30 and one for Nov 29 00:00. | NEW | Team |
| H8 | Nov 27 18:00 | Branch protection on main: PR required, block force pushes and deletion, 0 approvals or admin bypass, **no** required status checks (the workflows are path-filtered). | 129 | Divesh |
| H9 | Nov 27 (daytime, feeds fresh) | Teammate phone test on iPhone Safari and Android (low-end too, if available). Use fresh wallets and a stopwatch for 3 runs. Check reload /me, then sign out and back in after A6 ships. Post a results table. | 146, 76, 88 | Teammates |
| H10 | Nov 27 | QIE Wallet test with a fresh wallet: connect, switch to 1990, sign SIWE, sign the createBot request. Record the wallet version and tx hash. | 99 | Whoever has QIE Wallet |
| H11 | Nov 27 | Top up the **committer** 0xd277…5D45 (2.50 QIE, nearest the 2 QIE alert) toward 10. The relayer is 0x5955…8004 with 5.50. **Don't send to 0x24bA…7457: that is the admin cold key.** | 97 | Divesh |
| H12 | Nov 27 | Two people keep offline backups of the admin cold key and the deployer key. Log the names only in decisions.md. | 157, 138 | Divesh + 1 |
| H13 | Nov 27 | Read the Supabase pooler size and send it to Claude (A16). Set the Anthropic console spend limit and check Haiku pricing. | 139, 183 | Divesh |
| H14 | Nov 28 20:00 | Run `pg_dump` of prod to an encrypted local file. Repeat after each close. Never upload it as a CI artifact (the repo is public). | 139 | Divesh |
| H15 | Nov 28 (after a debut is proven) | Soft launch to 5–15 people before S1 opens Nov 29 00:00. Use Claude's drafts (D1) and keep team wallets on a separate list. | 112, 113 | Team |
| H16 | Nov 28 20:30–23:30 | Watch the S0 close: closeSeason tx, trust commit, replay upload, recap. Use runbook §9 (D2). | 152 | On-call |
| H17 | Nov 29 00:00–00:30 | Watch S1 open: `nextSeason()`, /healthz. | 152 | On-call |
| H18 | Nov 29 midday | If S0 produced a real v2 diff, approve it on a phone and keep the tx hash. Record the phone path, /proof, /stats, and an explorer tx showing from = relayer and signer = user, with feeds fresh. | 116 | Divesh |
| H19 | Nov 29 21:00 | Draft every form field: repo, live URL, BotForwarder 0x4540D079EdD350388d1B3d40e7F71Db2E8DfB63b first, track, video link, deck link, team wallet. Upload the video unlisted. Review the deck. | 121, 116, 117 | Divesh |
| H20 | Nov 29 21:00 | Check the Community Choice and Best Student Team rules on hackathon.qie.digital. Plan a vote ask that keeps the no-prizes wording for users. | NEW | Divesh |
| H21 | Nov 30 18:00 | Each owner rehearses a 10-minute walkthrough plus the four judge questions in their own words. | 122 | All three |
| H22 | Nov 30 21:30–21:50 | Watch the S1 close, then take /stats screenshots (user-signed numbers first, system separate, team wallets separate) and the S1 board. | 120 | On-call |
| H23 | **Nov 30 22:00** (fallback 23:00) | Submit the form. Check every link signed out in an incognito window. Save the confirmation, tag `v1.0-submission`, and log it in decisions.md. | 121 | Divesh |
| H24 | Nov 30 | Fill the names in the Dec 1–7 rota and the runbook "Who" rows. | 169, 138 | Divesh |
| H25 | Dec 1–7 | On-call. S2 closes Dec 2 21:30, S3 Dec 4 21:30, S4 Dec 6 21:30. S5 (weekly) opens Dec 7 00:00. Run the demo-week presentation with S1 and S2 results, plus S3 if presenting Dec 5. | 169, 123 | Team |
| H26 | Mondays from Dec 7 | Weekly /stats report: user-signed numbers first, system numbers separate. | 180 | Divesh |

---

## 4. Build waves for Claude

Each wave is a set of PRs, never one big PR. Hour figures are estimates; the actual work may go faster. Review and merge time is the user's, not Claude's.

**No-merge windows for worker-touching PRs** (render.yaml has `autoDeploy: true`): 08:55–09:25, 12:55–13:25, 16:55–17:25 and **20:55–00:20 IST**.

### Wave A, code: last merge Sat Nov 28 20:50 IST

Ordered by submission impact, then by dependency. The reliability items (A1–A4) need to land by **Nov 28 12:55** so they help the S0 close.

| ID | Issue | Title | Change and files | h | Acceptance check |
|---|---|---|---|---|---|
| UR | NEW (filed per bug) | /ultrareview critical and high fixes | Per §5. These come before the feature items they touch. | 5.0 (budget) | Each bug has a regression test, and its issue is closed by its PR |
| A1 | NEW (ws:B) | Retry season_close and season_open within the night | `apps/worker/src/scheduler/jobs.ts`: close at 21:30–23:15 IST every 15 min, open at 00:00–01:20 every 10 min. The **SPEC §6.1 table changes in the same announced PR.** Extend the jobs-vs-spec test. | 1.0 | Tests pass. A repeat run does nothing once chain state says it is done. |
| A2 | 163 | Boot alert + debut failures in health | `index.ts`: send `worker_started <commit>` once. `slot/debut.ts`: call `health.recordJobRun('debut', {problem})` on failure. Add one test each. | 1.25 | The alert reaches Discord after deploy. A failing debut shows in /healthz. |
| A3 | 163 | Missed-slot watchdog | `alerts/index.ts` checkAlerts: alert once if a slot window ended more than 25 min ago with no `lastSlotRun`. Test with a fake clock. | 1.0 | Unit test passes |
| A4 | 152 | Season-close rehearsal | Run `test:anvil` (close.e2e, replay.e2e) on main. Rehearse on a fork **of the deployed 1990 contracts** with the committer impersonated: close → commitScores → v2 → S1 open. Check that every close-path tx goes through `system/sender.ts` and that SYSTEM_MIN_GAS covers the largest batch. Add a manual-fallback runbook entry (Admin.s.sol / launch-admin.sh). **No mainnet txs.** | 3.0 | Gas used and tx order posted in #152, with any fixes merged by Nov 28 12:55 |
| A5 | 76 | Prove the debut after the gas fix | Check the 09:00 slot and any new debut (from H9) in Render logs, Trade events and `/api/v1/bots/<id>/record`. Confirm a stale-feed debut holds or picks Gold and shows a reason. Fix the root cause if it fails. | 1.5 | A PaperLedger Trade event for a user bot, and a non-empty trades record |
| A6 | 93 | Newcomer frictions | **Sign out** on /me, wired to the existing `signOut()` in `lib/wallet.ts`, plus a "Signed in as 0x…" line. A **My bot** link in AppHeader and the footer. CreateFlow runs the `botOf` check right after sign-in and adds a `has_bot` phase ("Open my bot", no persona LLM call). After 12 s, show "first passkey can take up to a minute". The /me SignInCard sends new users to the home page, closing the gap where they skip the 18+ tick. Tests in MeScreen and CreateFlow. | 3.0 | Tests pass, then the phone retest in H9 |
| A7 | 89 | Bot page contradictions | `BotPageView.tsx` and `lib/bot-record.ts` callLabel: if a call says executed but has no trade, show "Sending to QIE", then "Didn't reach QIE, tries again next call". Held calls show "QIE's BTC price is N min old, so it held. Next call HH:MM". Map `reason_tag` to plain words. Copy: "first mark comes with its first trade on QIE". | 1.5 | /bot/4 no longer shows "Traded" next to "No trades" |
| A8 | 105 | Real card pages don't crash | `lib/site/data.ts` getCard: adapter from the shared CardPayload (`cites`, `oracle.roundId`, `proves`) to the site card. Use the cited asset's feed instead of hard-coded GOLD (`interactive.tsx:17`). Adapter test with a worker-shaped fixture. | 2.5 | One real `/card/<id>` renders the Verify panel with tx, round and feed links |
| A9 | 109 | Unfurls | `api/card/fixtures.ts` loadCard reads real rows in production (mocks stay in previews), with the same adapter as A8. Add `openGraph.images` and `twitter: summary_large_image` on /card/[cardId], and a static OG image for / and /bot/[id]. Update the route test. Trade, roast and recap cards only. | 2.5 | `/api/card/<real id>` returns a PNG in production. WhatsApp and X screenshots in the issue. |
| A10 | NEW (ws:C) | Show real bots, not examples, while S0 stays hidden (D3 option b) | `lib/site/live.ts` arenaRacers falls back to `fetchBots()` with a line "Season 1 starts Sun Nov 29, 00:00 IST". Hide bot-of-the-week when there is no data. `lib/site/judges.ts` reads ids from `/bots`. LeaderboardsView shows the S1 start on 404. Remove "simulated until the app is live" in live mode. **No schema change.** | 3.0 (copy-only fallback 0.5) | No fake bots appear in live mode, and judges' latest trades load |
| A11 | 219 | Wording fixes | `app/page.tsx:27`: "zero real money at risk", and reword "nobody can fake it" to "every trade settled against QIE's official mainnet oracle and recorded on QIE". `lib/site/sample.ts:33`: Granny set to "50% Gold, 50% cash". docs/env.md: TRUSTED_PROXY_HOPS confirmed from a real header. | 0.5 | Copy matches on the live page |
| A12 | 189, 100 | Labels judges see | `developers/page.tsx`: real worker URL, drop COMING. `judges/page.tsx`: video block appears only when `NEXT_PUBLIC_DEMO_VIDEO_URL` is set, with the label "Recorded on live mainnet data". QIE Wallet MCP and QIE ID marked verified with a date. QIE Wallet stays "IN TESTING" until #99 passes. Add qie-components.md rows for names, the MCP (6 tools, Nov 27), and QIE Pass (UNVERIFIED). | 1.5 | No placeholders left on /judges or /developers |
| A13 | NEW | Explain the 1,078 on-chain amount | One line in the /proof and /judges proof block: "On chain every bot starts with 1,078 play units (PaperLedger.START_CASH_E8); the app shows ×100,000/1,078." Never call the balance USDT. | 0.3 | Copy is live |
| A14 | 174 | Deletion contact | `privacy/page.tsx` §9: "email X; we delete off-chain data within N days; on-chain records stay". Needs D2. #300 stays on hold. | 0.25 | The TODO(#172) lines are gone |
| A15 | NEW | Repo hygiene | Add `.claude/` to `.gitignore`. Commit or ignore the untracked broadcast JSON (it holds public data only). | 0.1 | `git status` is clean |
| A16 | NEW, only if H13 shows the pool is under about 37 | Cap DB pools | Set relay and persona `openDb` max to 3 (`relay/setup.ts`, `persona/setup.ts`). Don't switch to the transaction pooler (6543); its effect on advisory locks is UNVERIFIED. | 0.5 | Total connections stay at or below the pool size |
| **Total** | | | | **≈ 28.4** | |

### Wave A, docs and submission pack: by Sun Nov 29 21:00 IST

These PRs don't redeploy the worker, so the freeze doesn't block them.

| ID | Issue | Title | Change | h | Due | Acceptance check |
|---|---|---|---|---|---|---|
| D1 | 113, 112 | Launch copy + stopwatch sheet | X thread, WhatsApp message, challenge-link message, 5-min coding-club run sheet, stopwatch sheet. Uses the oracle wording and the play-money line, and promises no prizes. | 1.5 | Nov 27 eve | Team approves it |
| D2 | 169, 131 | Runbook additions | §9 first-run checks for every untested path (log lines, /healthz fields, read-only SQL, `cast call` on rpc3, what to do on failure). A Dec 1–7 on-call table on the current calendar. The merge windows in release.md. | 2.0 | Nov 28 12:00 | Used during H16 |
| D3 | NEW | Fix the stale calendar | SPEC §12 day plan (lines 660–668), §13 "S1+S2 closed" (line 697), line 172, and release.md §7 (still says S2 closes Nov 29). One announced docs PR. | 0.5 | Nov 28 | Dates match seasons.sql |
| D4 | 118 | README final | Live URL. "Claude Haiku 5.5 via LlmClient (swappable by env)" in README and architecture.md. Dated statuses. Remove the "until deployed" lines. Fresh-clone check in a temp dir. Video link after H19. | 1.5 | Nov 29 | Fresh clone builds. Every claim carries a date or UNVERIFIED. |
| D5 | 122 | docs/judge-qa.md | Four answers (forwarder, stale feeds, Approve Big Move double-execution, why blockchain) with file:line pointers, plus the known limits D5 and D6. | 1.0 | Nov 29 | Owners rehearse from it |
| D6 | 68 | Replay S0 on mainnet | `pnpm replay 0 --ledger 0x32883a86…f902`. Update docs/replay.md with the real output and link it from /proof and the README. A mismatch is a P0, to fix before the S1 close. | 1.0 | Nov 29 a.m. | Exit 0, and the root matches `seasons(0).dataRoot` |
| D7 | 117 | Deck draft (Slides artifact) | 8–10 slides: problem, coaching → v2 diff, demo path, architecture, why blockchain, QIE components (live vs COMING), honest traction, roadmap (QIE Pass, push), team. Disclaimer on every slide. | 3.0 | Nov 29 | Humans review it |
| D8 | 116 | Video cuts | Rebuild the 30 s and 2 min cuts from the human recordings (H18). No "not deployed" card. The footer on every frame. Haiku, not Grok. Real data or an EXAMPLE label. | 3.0 | Nov 29 | Uploaded unlisted |
| D9 | NEW | LICENSE | Add the file once D10 is decided. | 0.1 | Nov 28 | File in the repo root |
| **Total** | | | | **13.6** | | |

### Wave B: nice-to-have before submission (Nov 29 00:20 → Nov 30 20:00)

Freeze rules apply: fixes and docs only, web-only where possible. No worker merges after Nov 30 12:55 except emergencies.

| ID | Issue | Title | Change | h | Acceptance check |
|---|---|---|---|---|---|
| B1 | 82 | "Your cards" on /me | List the newest 5 `site_cards` by bot_id, each linking to `/card/<id>`. This is a feature, so it needs a **freeze exception** (D12). | 1.0 | Links open real cards |
| B2 | NEW (89) | Price ages and caching | `lib/site/ticker.ts` passes `updatedAt`. The Ticker computes age on the client and shows a "DELAYED" badge when every crypto feed is stale. `/stats` and `/judges` use `force-dynamic`. Update the unit tests. | 1.5 | No baked-in or old ages in cached HTML |
| B3 | 89, 88 (+147 folded in) | Error pages and 360 px pass | Root `app/error.tsx` and `not-found.tsx` built on ErrorFallback plus the footer. A 360×780 sweep of every route (scrollWidth ≤ clientWidth). Axe on landing and create, fixing only critical items. | 3.0 | No crash pages, no horizontal scroll |
| B4 | NEW | /me season date | Show the real next visible close (S1, Nov 30 21:30), not "tonight". | 0.5 | Copy is correct |
| B5 | 123 | docs/mcp-demo.md | Config for both MCPs (BotFolio and QIE Wallet), 3 prompts, and a dated real transcript. Check from a real client. If it's done by Nov 29 15:00, the clip goes into the video. | 2.0 | Transcript pasted. Claude Desktop support stays UNVERIFIED unless tested. |
| B6 | 154 | RLS test | A PGlite test that switches to the anon role and expects errors on users, relay_log, big_moves.runner_sig and daily_calls.bot_up_sig. | 0.3 | Test passes |
| B7 | NEW (182), if D14 says yes | Feedback link | `NEXT_PUBLIC_FEEDBACK_URL` in the footer, hidden when unset, plus a line on /privacy. | 0.5 | Shows only when set |
| B8 | NEW | LLM price table | Update `packages/llm/src/budget.ts` DEFAULT_PRICES after H13. Runbook §3c: what happens when the cap is hit (the month resets Dec 1). | 0.3 | Prices match the official page |
| B9 | NEW | /ultrareview medium fixes | Only fix-shaped ones. | 2.0 | Per bug |
| **Total** | | | | **11.1** | |

### Wave C: demo week (Dec 1–7, after the `v1.0-submission` tag)

Same merge windows. Avoid Dec 2, Dec 4 and Dec 6 from 20:55, and Dec 7 around 00:00.

| ID | Issue | Title | h | Acceptance check |
|---|---|---|---|---|
| C1 | 164 | Funnel counts `confirmedCreates` and `botsWithFill` in `stats/stats.ts`, with a PGlite test and steps on /stats. Labelled as product outcomes, not user-signed activity. No vendor SDK. | 1.5 | Test passes, page shows the steps |
| C2 | NEW (163) | Alerts for relay reverts (last 10 min) and indexer lag (over 60 blocks), shown in /healthz | 2.0 | Unit tests |
| C3 | NEW (89) | Rows for held and OrderSkipped events on the bot page and /proof, with the reason and an explorer link | 2.5 | A real skip renders |
| C4 | 65 | 20-relay fork smoke test (cut down from 200) | 1.0 | No nonce gaps or collisions, correct refusal codes |
| C5 | NEW | DNA head instead of the emoji on /bot/[id] | 0.5 | Visual check |
| C6 | 115 | Support the end-to-end challenge check: confirm /stats counts the accept as user-signed | 0.5 | Count confirmed |
| C7 | NEW | Low-severity /ultrareview fixes that are real bugs | 2.0 | Per bug |
| **Total** | | | **10.0** | |

### Deferred (after the hackathon)

| Issue | Item |
|---|---|
| #98, #110 | QIE Pass application and badge (roadmap slide only, never claimed as integrated) |
| #94 | Web push |
| #141 | Playwright end-to-end tests |
| #132 | Migrations CI and auto-apply |
| #155 | Turnstile |
| #161 | Sentry |
| #182 | Feedback table (B7 is the stopgap) |
| #181 | Second-wave growth campaign |
| #183 | Ops-log reviews (human, from mid-December) |
| #103 | Domain (log "submit on bot-folio.vercel.app" now) |
| #174, PR #300 | Rebase and settle the deletion flow (D1) |
| #65 | Full 200-relay load test |
| #147 | Lighthouse CI budget |
| #219 leftovers | Temperature, prompt-hash and token migration; prompt-v2 "reason hint" rule |
| — | Rotation drill on a fork (#157) |
| — | Transaction-pooler switch |

---

## 5. /ultrareview slot

**When:** after the user approves this plan and before Wave A work starts in earnest. Target: Nov 27 by 12:00 IST. A1–A4 don't depend on the review, so Claude can start them while it runs.

**Who:** **the user runs it.** Claude can't start it, because it is a billed multi-agent cloud review. The command is `/code-review ultra <target>`.

**Target:** it reviews a diff, so pick one of these:
- (a) a branch diffed against an early base commit; or
- (b) paths: `apps/worker/src`, `apps/web/app`, `apps/web/lib`, `apps/web/components`, `packages/shared`, `packages/llm`.

Add `packages/contracts/src` for awareness only. Scope and billing for path targets are UNVERIFIED.

**Intake (Claude):**
1. Dedupe against existing issues. The #105 card crash is already known.
2. File one issue per kept bug, with a `ws:` label, a severity and a milestone.
3. Map each bug to a wave:

| Severity | Examples | Wave |
|---|---|---|
| Critical | Data loss or exposure, relay or auth bypass, broken close, debut or slot, wrong money maths, legal wording | **Top of Wave A** (UR) |
| High | Visible break on the newcomer, card or judges path | Wave A, merged into the matching item when it's the same file |
| Medium | Edge cases, polish | Wave B if it's fix-shaped and web or docs only, otherwise Wave C |
| Low / nit | | Deferred |
| Contract finding | Any severity | **No redeploy**: the addresses are submitted and roles are set. Mitigate in the worker, document it, and add it to the judge Q&A. |
| Frozen-interface change (`schema.sql`, `packages/shared`, `abi`) | | One announced PR plus a hand-applied `0005_*.sql` |

**Budget:** 5 h Wave A, 2 h Wave B, 2 h Wave C. If critical and high fixes need more than 5 h, cut A10 to copy-only first, then move A9 to Wave B.

---

## 6. Execution model

- One issue → one branch `<ws>/<issue#>-short-name` → one PR that says `Closes #n`. NEW items get an issue first. "All in one go" means one wave in time, not one PR (CLAUDE.md).
- Claude implements the PRs, in parallel worktrees where they don't overlap. The user reviews and merges. Gokul or Dijo review the worker and web PRs they can explain. Commits stay small and honestly attributed (`Co-Authored-By`).
- **Disqualifier guard:** judges are warned about "AI-generated with minimal developer contribution", and about 136 of 547 commits since Nov 15 are co-authored by Claude. Owners review, comment on and explain their workstream's PRs and rehearse them (#122).
- **Merges:** worker merges outside the no-merge windows (§4). Batch them into about one deploy per window. After each deploy, check /healthz and that the boot alert (A2) arrived.
- **Verification per wave:**

| Wave | Checks |
|---|---|
| A | `pnpm -r test`, worker `test:anvil` for A1 and A4, `forge test` untouched. Live: /healthz, a real card in production, sign out and has_bot on a phone, A10 pages in live mode. |
| A-docs | Fresh clone builds. Links checked signed out. No "trustless"-style wording. Footer present. |
| B | Same as A, plus the 360 px sweep. Phone retest of the 30 s path after any web change. |
| C | Same as A. Watch each season close. |

---

## 7. Timeline (IST)

| When | Event | Claude | Humans |
|---|---|---|---|
| Nov 27 08:55–09:25 | **First scheduled slot** | No merges | H1 (Divesh) |
| Nov 27 by 12:00 | /ultrareview, webhook, registration | Start A1–A4 | H2–H5 |
| Nov 27 13:25–16:55 | Merge window | A1–A3 PRs | Review and merge |
| Nov 27 daytime | Phone test, QIE Wallet test | A5, A6, D1 | H6–H13 |
| Nov 27 20:55–00:20 | First Daily Call settle and recap (UNVERIFIED) | No worker merges | Watch |
| Nov 28 09:25–12:55 | Merge window; **A1–A4 must be in** | A4 results, A7–A9, UR fixes | Merge |
| Nov 28 daytime | Soft launch | A10–A16, D2, D3, D9 | H15 |
| **Nov 28 20:50** | **Last Wave A code merge** | — | — |
| Nov 28 21:30 | **S0 close**, recap at 21:35 | Read logs, fix anything (merge after 00:20) | H14, H16 |
| Nov 29 00:00 | **S1 opens; code freeze starts** | — | H17 |
| Nov 29 a.m. | Replay S0, v2 approve, recording | D6, D4, D5 | H18 |
| Nov 29 21:00 | **Submission pack ready** | D7, D8 done | H19, H20 |
| Nov 30 to 20:00 | Wave B fixes (worker until 12:55) | B1–B9 | H21, H24 |
| **Nov 30 21:30** | **S1 close** | Watch logs | H22 |
| **Nov 30 22:00** | **Submit** (fallback 23:00) | — | H23 |
| **Dec 1 04:29** | Hard deadline | — | — |
| Dec 1 00:00 / Dec 2 21:30 | S2 opens / S2 closes | Wave C | On-call, S2 screenshots |
| Dec 3–4 / Dec 5–6 | S3, S4 (S4 closes Dec 6 21:30) | Wave C | Demo presentation (day TBD), H25 |
| Dec 7 00:00 | S5 opens (weekly); check `nextSeason()==6` afterwards | — | On-call, first #180 report |

---

## 8. Risks and open decisions

### Top 8 risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | The S0 close fails at Nov 28 21:30, so S1 refuses to open ("previous_not_closed") | A1 retries, A4 fork rehearsal, D2 runbook with a manual fallback, named on-call (H7) |
| 2 | Stale crypto feeds (52–91 min gaps) mean slots hold, so there are few trades, cards or v2 diffs | A7 and B2 make holds read as intended. Record when feeds are fresh. Keep the 30-min rule (it's a hard rule) and ask QIE about the feed heartbeat. |
| 3 | The 30 s claim fails (Android passkey ~60 s; iPhone UNVERIFIED) | A6 progress copy. Re-word the claim after H9 (D9). |
| 4 | Nobody is available during Dev3pack Nov 27–29 | H7 staffing. Merges batched into windows. Claude carries the docs and video drafts. |
| 5 | The submission or registration is missed | H2 today, H19 draft Nov 29, submit at 22:00 with a 23:00 fallback |
| 6 | The merge wave restarts the worker mid-slot or mid-close (autoDeploy) | No-merge windows, boot alert, the 20:50 Sat cutoff |
| 7 | Infra: Render free-plan sleep, Supabase pool limit, no managed backups, possible RLS leak | UptimeRobot plus a second pinger or Starter (D8), A16, H14 `pg_dump`, H6 and B6 RLS checks |
| 8 | "AI-generated / minimal contribution" judging, or metrics overclaims | §6 guard, rehearsals, team wallets listed separately, no staged v2 shown as organic coaching |

### Open decisions for the user

| # | Decision | Recommendation |
|---|---|---|
| D1 | PR #300 (data deletion) | Hold until after Dec 7. Ship the contact email (A14) now. |
| D2 | Deletion contact email | A team-owned address, needed by Nov 28 a.m. |
| D3 | S0 visibility | Keep it hidden, as approved in #219, and do A10 option (b). Showing S0 as "Preseason" would be a spec change to the frozen schema views. |
| D4 | Counting S0 in traction | Count S0 user-signed txs on /stats (real `_msgSender`). List team wallets separately. No S0 results on boards. |
| D5 | Expired cumulative SELL can end above 50 % (a known limit, decisions.md:33) | Accept it for the hackathon and document it in the trust rules and judge Q&A. Fix after Dec 7. |
| D6 | Second big move in one decision is dropped, with no F1 penalty | Keep, as approved in #219 Part C. |
| D7 | Bot #4's failed debut | Let the scheduled slots trade it. Don't add a re-debut path now. (Claude sends no txs.) |
| D8 | Render plan | Starter at $7/mo for Nov 28–Dec 7 if a card is available, with a new decisions.md entry (it reverses decisions.md:38). Otherwise add a second pinger. |
| D9 | Wording of the 30 s claim | Decide after H9, e.g. "about 30 s after your passkey". |
| D10 | Licence | MIT, unless the team prefers otherwise. |
| D11 | Video data | S0 data plus EXAMPLE labels: S1 results can't exist by Nov 29. Re-date #116. |
| D12 | Freeze exceptions for B1 and B2 | Allow web-only, or move them to Wave C. |
| D13 | Debut steering on stale feeds | Already decided (#219 item 18: offer only fresh assets). No change. |
| D14 | Feedback link through a third-party form or group | Yes only with the /privacy line (B7). |

---

## 9. Totals and sanity check

| Owner | Wave A code | Wave A docs | Wave B | Wave C | Total |
|---|---|---|---|---|---|
| Claude | 28.4 (incl. 5 UR) | 13.6 | 11.1 | 10.0 | **63.1** |
| Divesh | ~14 (H1–H6, H8, H11–H14, H16, H18–H19, ~6 h reviewing and merging about 25 PRs) | — | ~5 (H21–H24, merges) | ~6 (on-call, H26, #115 campaign) | **~25** |
| Teammates | ~6 (H7, H9, H10, H12, H15, H17) | — | ~2 (H21) | ~8 (rota, #123 presentation) | **~16** |

**Will Wave A fit?** From Nov 27 10:00 to the Nov 28 20:50 code cutoff is about 35 h of wall time. The docs pack runs until Nov 29 21:00, which is about 59 h. Claude's 42 h of Wave A work fits only with parallel worktrees, and only if the user merges in 4–5 batches inside the windows.

**The real bottleneck is human review during Dev3pack.** If anything in A1–A9 is still unmerged at **Sat Nov 28 12:00**, cut in this order:
1. A10 to copy-only (saves 2.5 h).
2. A16 if the pool is fine.
3. A9 to Wave B (link previews stay plain text).
4. D8 becomes a captioned screen recording.

The minimum Wave A is about **35 Claude-hours**. A1–A6, A8, A11, A12 and A14 are not negotiable.

**Not checked while drafting:**
- Whether a worker re-debut path exists.
- The Render region, the Supabase pool size and backups, and ALERT_WEBHOOK_URL on Render.
- /ultrareview runtime and scope.
- The current balances. These came from tonight's triage, and the #97 relayer address is corrected per the critique.

*Play money. Not investment advice. No prizes.*