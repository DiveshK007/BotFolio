# BUILD_BRIEF: putting the BotFolio website into `apps/web`

Owner: WS C (pages, components) with WS D (`/api/card`, `/api/v1`, card payloads, docs). Read `CLAUDE.md` and `SPEC.md` first.

## What's in this export
```
apps/web/
  app/layout.tsx                 root layout: fonts (next/font), theme script, CSS imports. Merge if WS C already has one
  app/icon.svg                   favicon (bot head)
  app/(site)/layout.tsx          Nav + Footer for website pages
  app/(site)/page.tsx            /            (S1 landing)
  app/(site)/judges/page.tsx     /judges
  app/(site)/proof/page.tsx      /proof       (S8, includes the /stats split)
  app/(site)/stats/page.tsx      /stats → redirect to /proof#stats
  app/(site)/leaderboards/...    /leaderboards (S6)
  app/(site)/bot/[botId]/...     /bot/[botId] (S4)
  app/(site)/card/[cardId]/...   /card/[cardId] (S7)
  app/(site)/developers/...      /developers
  app/(site)/about/...           /about (S9)
  app/(site)/**/opengraph-image.tsx   OG card per page (lib/site/og.tsx)
  components/site/ui.tsx         Badge, StatusBadge, Placeholder, PriceAge, TxChip, Icon, Note, ErrorFallback, Skeleton
  components/site/BotHead.tsx    mascot (eyes follow pointer; off under reduced motion)
  components/site/chrome.tsx     Nav, Footer, CopyButton, themeScript
  components/site/demos.tsx      Mascot, TryBot, HowItWorks, CoachDemo (client)
  components/site/interactive.tsx FlipCard, AgentDemo, JudgesTour, LeaderboardTabs (client)
  components/site/proof.tsx      SeasonCountdown, ContractsTable, FeedsTable, PricesTable, LatestTrades, ActivityPanel (server)
  lib/site/types.ts              data shapes (mirror SPEC §3/§4; swap for @botfolio/shared once frozen)
  lib/site/format.ts             ₹, %, e8 → number, IST times, price-age rule, short hashes
  lib/site/sample.ts             EXAMPLE data (patterned hashes; never linked)
  lib/site/data.ts               server loaders with LIVE / EXAMPLE / NOT LIVE / ERROR status
  styles/tokens.css, site.css    design tokens + components (plain CSS; class names = prototype)
prototype/index.html             the working single-file prototype (open in a browser)
screens/                         every page and state, 1440 + 360, light + dark
og/                              OG cards rendered from the build (1200×630)
SITE_SPEC.md                     per-page purpose, sections, states, flows, copy rules, data
```
Verified here: `tsc --noEmit` clean and `next build` passes on Next 15.5 / React 19 with `@botfolio/shared` aliased to `packages/shared/src`, plus viem and server-only.

## Build order
1. **Scaffold** (if not done): `pnpm create next-app@latest . --ts --app --tailwind --eslint --src-dir=false --import-alias "@/*"` in `apps/web`, then add `@botfolio/shared`, `viem`, `server-only`.
2. **Tokens and chrome:** copy `styles/`, `app/layout.tsx` (merge), `app/(site)/layout.tsx`, `components/site/{ui,BotHead,chrome}.tsx`, `lib/site/{types,format}.ts`. Keep Tailwind; these are plain CSS and don't clash. App screens should use the same tokens (`var(--accent)` etc.) so site and app look like one product.
3. **Proof first** (it's the one with real data today): `lib/site/data.ts`, `components/site/proof.tsx`, `/proof`, `/stats`. Check that `PricesTable` shows LIVE prices from the QIE RPC.
4. **Home:** `demos.tsx` + `/`. Then `/about`.
5. **Judges, leaderboards, bot, card, developers** with `interactive.tsx`.
6. **OG:** `lib/site/og.tsx` + per-route `opengraph-image.tsx`. Optional: load Archivo 800 into `ImageResponse` (`fonts` option) for bolder titles. The default font is used now.
7. **Go live:** swap `SITE_DATA_MODE` (below) and replace examples with real snapshots.

## Data wiring
| Loader | Source | Status today | When live |
|---|---|---|---|
| `getOraclePrices()` | `eth_call latestRoundData()` on the 5 feeds via `QIE_RPC_URLS` with failover | **LIVE now** (verified feeds, SPEC §0.2) | same |
| `getContracts()` | `FORWARDER_ADDRESS`, `BOT_REGISTRY_ADDRESS`, `PAPER_LEDGER_ADDRESS`, `SEASON_LEDGER_ADDRESS`, `TRUST_REGISTRY_ADDRESS`, `DAILY_CALL_ADDRESS`, `CHALLENGES_ADDRESS` | placeholders | after deploy (~Nov 22) |
| `getLatestTrades()` | Supabase view `site_latest_trades` (indexed `trades` + `bots`) | EXAMPLE | WS B creates the view, ~Nov 25 |
| `getActivity()` | Supabase view `site_activity_stats` (user-signed by `_msgSender` vs system) | NOT LIVE (no example numbers, ever) | WS B/D, ~Nov 25 |
| `getLeaderboards(n)` | Supabase RPC `site_leaderboards(season)` | EXAMPLE | after S1 opens (Nov 26) |
| `getBotRecord(id)` | `GET ${APP_URL}/api/v1/bots/:id/record` (WS D) | EXAMPLE (bot 12 only) | ~Nov 25. Ask WS D to add `priceE8` + `priceAgeMin` per holding |
| `getCard(id)` | Supabase view `site_cards` (WS D's `cards` table) | EXAMPLE (`example-roast`, `example-evolution`) | after first cards |

View and RPC names are proposals. Agree them with WS B (`schema.sql` is frozen Day 1), then edit `data.ts`. All reads are server-side with `revalidate: 60`; on failure, the section shows `ErrorFallback` with an explorer link, never made-up numbers.

**Env** (server only, never `NEXT_PUBLIC_*` except the existing anon key):
- `SITE_DATA_MODE` = `example` (until ~Nov 25) | `notlive` | `live`
- `APP_URL`, `RENDER_SERVICE_URL`, `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `QIE_RPC_URLS`, the contract addresses above

## Definition of done
- [ ] All 8 routes render at 1440 and 360, light and dark, with no element wider than the viewport.
- [ ] Footer line on every page. No "trustless"/"decentralised"; no money words as CTAs (grep the built HTML).
- [ ] Every data block shows LIVE / EXAMPLE / NOT LIVE YET; no EXAMPLE hash links to the explorer.
- [ ] Error path checked by pointing `SUPABASE_URL` at a bad host: sections stay, fallback shows, no numbers.
- [ ] Price-age label on every price; gold shows amber when ≥60 min.
- [ ] axe (wcag2a/aa) clean on every route in both themes; keyboard works for tabs, tour, flip card, coach demo.
- [ ] `pnpm typecheck`, `pnpm build` and tests pass; OG cards unfurl on WhatsApp and X (check with real links).
- [ ] QIE components still COMING unless `docs/qie-components.md` confirms them.
- [ ] Remove any example that has been replaced by real data; update "Where we actually are" copy.
