# Product website: master brief — BotFolio

## Inputs
- **Product name:** BotFolio (always capital F)
- **Repo / codebase:** https://github.com/DiveshK007/BotFolio. Source of truth: `SPEC.md` (v1.1) and `CLAUDE.md` at the repo root. Read both before anything else.
- **One-line pitch:** "Raise an AI trader in one sentence, coach it every season, and let QIE keep score."
- **What it is (short):** anyone describes a trading personality in one sentence; an AI bot is born and paper-trades 5 assets (BTC, ETH, SOL, XRP, Gold) with play money, 4 times a day. Every trade is priced by QIE's official mainnet oracle and recorded on QIE mainnet. The owner coaches the bot ("bad call: too risky"), approves its big moves, and each season approves a new version of its brain — committed on-chain. Built for QIE Hackathon 3.0 (Mainnet Edition), AI + Autonomous Agents track.
- **Audiences, and the one question each brings:**
  1. **Newcomers** (students, casual market watchers, mostly in India, on phones) — "What is this and can I try it in 30 seconds?"
  2. **Hackathon judges** — "Is it real, on mainnet, original, and does it use QIE properly?"
  3. **QIE / crypto-native community** — "Is the record actually verifiable, and which QIE pieces does it use?"
  4. **Developers / AI agents** — "Can I read a bot's track record from my own app or agent?"
- **Brand:** no brand assets exist yet. Derive from the repo if any appear; otherwise propose a direction and show it to me before building pages. Existing characters from the spec you can use: user bots are each a named persona with an emoji (e.g. "Gold Guru"); there are house bots with fixed personalities (e.g. *Steady Sam*, *Gold Granny* — see SPEC §8).
- **Live data:** not live yet. Contracts deploy to QIE mainnet ~Nov 22; the app goes live ~Nov 25. Planned public sources (SPEC §10, §10.1):
  - `GET /api/v1/bots/:id/record` — bot, versions + config hashes, trades with tx hashes + oracle roundIds, season results, trust score
  - `/stats` data — user-signed vs system on-chain activity
  - leaderboards (Top Returns, Best Risk-Adjusted (Sortino), Most Trusted, Coach vs Bot)
  - BotFolio MCP server (`get_bot_record`, `get_leaderboard`, `verify_trade`)
  - QIE mainnet explorer `https://mainnet.qie.digital` for every tx and contract
  Until these respond, build from the data shapes in SPEC §3 and §4, mark every value EXAMPLE, and leave the fetch wiring ready. When they're live, snapshot real responses and swap.
- **Real assets:** none yet. Real screen recordings and share cards will exist after the first seasons (Nov 26–27). Until then: no fake screenshots presented as real.
- **Pages wanted:** propose a sitemap. Must cover: home, a judges page, a live proof/stats page, a public leaderboard, the public bot page, and the play-money / not-advice / no-prizes page. The app's own screens (create bot, my bot, season close, etc. — SPEC §2.4) are built by the app team; the site must share their components and tokens, not redesign them.
- **Stack the site will ship in:** Next.js 15 (App Router, TypeScript) in `apps/web`, same app as the product, deployed on Vercel. Marketing pages and app screens live together.
- **Deadline:** prototype by Nov 24; in the repo before soft launch on Nov 25 evening (IST); final by Nov 28. Hackathon submission closes 23:59 CET Nov 30 (04:29 IST Dec 1).

## Goal
A product website that makes people feel BotFolio, not read a spec: the product's own moments recreated and playable in the browser, bots with personality, real on-chain proof wired to live data, and honest labelling of what's live vs illustrative. Ships as a working prototype plus everything a builder needs to put it into `apps/web`.

## Rule zero: honesty
- Every claim, number and feature must trace to the repo (SPEC.md, CLAUDE.md, docs, proof files, tests, contract state, API) or real assets. Keep a claims table (claim → source) and show it to me before building.
- Follow the repo's wording rules (CLAUDE.md). In particular:
  - Say "settled against QIE's official mainnet oracle". Never "trustless" or "decentralised".
  - Play money only. Every page footer: "Play money. Not investment advice. No prizes."
  - Never imply real money, tokens, NFTs, stakes, rewards, prizes or cash-out. No "invest", "earn", "profit" calls to action.
  - Never present relayer/runner transactions as user activity; user-signed numbers are shown separately (SPEC §11).
  - $ amounts are play-money display values converted from the oracle's USD prices (SPEC §3 display rule); every price shows its age (SPEC §5).
- Label everything: LIVE (read from the API/chain at load), EXAMPLE (illustrative mockup), REAL FOOTAGE. Never invent users, bots, testimonials, logos or metrics. A missing fact becomes a visible [PLACEHOLDER].
- QIE component status comes from SPEC §0.6. Show a component as live only when §0.6 says so. QIE Wallet pieces that depend on `signTypedData` stay "coming" until #189. QIE Pass stays "coming" while §0.6 marks it UNVERIFIED.
- Include an honest "what works / what's next" section.

## Phase 1 · Discover
- Read SPEC.md end to end, CLAUDE.md, docs/, proof files, env var lists, the app's UI code in `apps/web` (screens, states, copy) and any existing design files.
- Call every public endpoint that is live and save a real snapshot of each response. For endpoints not live yet, write sample responses that match the SPEC §3/§4 shapes exactly and mark them EXAMPLE.
- Inventory brand assets (logo, bot avatars, icons, fonts, sounds) — expect few or none.
- List: what the product does, each audience's question, the core loop, live vs simulated vs not built, real numbers, and BotFolio's signature moments. From the spec, the candidates are:
  1. One sentence → a bot with a name and personality → its first trade within ~30 s
  2. "Gold Guru wants 35 % in Gold. Allow?" — Approve Big Move, the user's signature is the trade
  3. The season-close v2 diff: "You said 'too risky' 3× → max per coin 40 % → 25 %", committed on-chain
  4. Roast / recap share cards with a "Verify on QIE" panel (tx, oracle round, what it proves)
  5. Daily Call: you vs your bot on BTC, settled by the oracle
  6. An AI agent asking the BotFolio MCP "Is this bot actually good?" and verifying from chain data

## Phase 2 · System and sitemap
- Write the design system before any page: tokens (colour for light and dark, type scale, spacing, radii, shadows, motion durations and easing), components (nav, buttons, chips, cards, stat tiles, tables, code blocks, video posters, LIVE/EXAMPLE badges, price-age label, explorer-link chip, play-money footer, empty/error/loading states). Contrast ≥ 4.5:1 for text in both themes.
- Reuse the app's tokens and components if `apps/web` already has them; the site and the app must look like one product.
- One motion personality used everywhere; all motion off under prefers-reduced-motion.
- Sitemap: one page per audience question. For each page list: purpose, sections in order, states (loading, empty, error, live, offline, stale price), flows (what happens on each click), copy rules, data sources, constraints.
- Voice: short, specific, warm, a little funny — the bots roast, the site doesn't preach. No AI-sounding prose. Headings carry the story, so someone who only reads headings still gets it.
- Show me the system, sitemap and claims table, then continue unless I object.

## Phase 3 · Signature interactions
Pick 3–5 of the moments from Phase 1 and build them as real, playable widgets that work without signing up:
- **Make a bot (try it):** type a sentence, see a persona card and a sample first trade appear. Clearly EXAMPLE unless wired to the real create flow; the real button goes to the app.
- **Coach it:** step through a bad call → correction → season-close v2 diff → "committed on QIE".
- **Live proof widget** fed by the real API/chain: latest trades with tx links and oracle rounds, user-signed tx counter, season countdown.
- **How it works** as a step-by-step animated diagram: sentence → bot → oracle-priced trade on QIE → coaching → new version on-chain → anyone can verify.
- **Verify a card:** a share card the visitor can flip to see the tx, oracle round and "what this proves".
Everything works with mouse, touch and keyboard.

## Phase 4 · Build the pages
- **Home:** hook (the one-line pitch + the signature widget above the fold), the product in action, how it works, proof (live), features as playable moments, the "why blockchain?" answer (SPEC §1.1: anyone can check, other apps/agents can read the record, the record outlives the app), honest status, clear next steps (try it, watch the demo, see live stats, read the code).
- **Judges page:** a 90-second guided scroll with a tour bar: what it is, live mainnet proof (verified contracts, real txs), QIE components used and where, user-signed traction numbers, the one sentence to remember, a copy button, links to repo, demo video and `/proof`.
- **Proof / stats page:** the 7 verified contracts with explorer links, oracle feeds and their max ages, the oracle caveat in plain words, user-signed vs system activity, how to replay and verify a season.
- **Leaderboard and public bot page:** match the app's screens (SPEC §2.4 S4, S6); logged-out friendly.
- **Play money / about page:** the play-money, not-advice, no-prizes notice in plain language.
- **Live data rules:** fetch on the server with short revalidation, show "last updated" and price age, keep the section and show a clear fallback with a proof link if a fetch fails; never fall back to made-up numbers. Format units properly (oracle prices have 8 decimals; times in IST with the zone shown; ₹ as play-money display).
- Mobile-first: most visitors arrive from WhatsApp/X links on phones. Desktop and mobile for every page, light and dark. Minimum width 360 px: no horizontal scroll, tables scroll in their own box, nav wraps.
- **Performance:** no heavy libraries, fonts preloaded with generic fallbacks, images sized and lazy, videos as poster cards linking out.
- **Accessibility:** real buttons and links, aria where needed, visible focus, decorative art aria-hidden.
- **SEO and sharing:** titles, descriptions, an Open Graph card per page; links must unfurl cleanly on WhatsApp and X.

## Phase 5 · Check (before telling me it's done)
- Screenshot every page at 1440 and 360, light and dark, and look at them: overflow, overlaps, clipped text, wrong fonts, broken images, duplicate ids.
- Run an overflow check (no element wider than the viewport) and a contrast check.
- Click through every flow and state, including API-down fallback, stale-price state and reduced motion.
- Check every page against the CLAUDE.md wording rules (no "trustless", play-money footer present, no money language).
- Re-check the claims table against the final pages.
- Tell me plainly what you couldn't check.

## Phase 6 · Deliver
- The working prototype, published as an artifact I can share.
- An export zip for the builder (Claude Code):
  - the pages and components as React/TSX for Next.js 15 App Router, ready to drop into `apps/web`
  - tokens.css and assets
  - screens/: every page and state as PNGs, desktop and mobile, light and dark
  - SITE_SPEC.md (not SPEC.md — that name is taken by the product spec): per page, its purpose, sections, states, flows, copy rules, data sources and constraints
  - BUILD_BRIEF.md: build order, where each piece goes in `apps/web`, the data wiring to the real endpoints, the definition of done
  - the og cards
- A short handoff prompt for Claude Code to build it in the repo, starting with "read CLAUDE.md and SPEC.md first" and ending with: run typecheck, build and tests, screenshot at 1440 and 360, show me the diff, and don't push or deploy until I say so.
- A list of open questions the brief left unanswered, with the decision you took for each.

Work through the phases in order. Ask me only if a choice is expensive to redo or the repo contradicts itself; otherwise decide, say what you decided, and keep going.
