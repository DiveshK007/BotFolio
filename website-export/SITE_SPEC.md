# BotFolio website: SITE_SPEC

Per-page spec for the marketing/proof pages that live in `apps/web` next to the app screens.
The product spec is `SPEC.md` (source of truth). If they disagree, SPEC.md wins: flag it, don't guess.

## Rules for every page
- **Footer on every page:** "Play money. Not investment advice. No prizes." plus "Settled against QIE's official mainnet oracle." (`components/site/chrome.tsx` → `Footer`). Never remove it.
- **Wording (CLAUDE.md):** say "settled against QIE's official mainnet oracle". Never "trustless" or "decentralised". No invest / earn / profit / stake / rewards / prizes as calls to action. Negations ("No prizes", "no stakes") are allowed.
- **Labels:** every data block carries LIVE, EXAMPLE or NOT LIVE YET (`StatusBadge`). EXAMPLE hashes (`0xe0a1…`, `0xc0f1…`) and addresses (`0x5eed…`) never link to the explorer (`TxChip`).
- **Unverified QIE pieces** (QIE Wallet connect, .qie names, QIE Wallet MCP, QIE Pass) show the COMING badge until WS D confirms them in `docs/qie-components.md`.
- **Missing facts** render as visible `Placeholder`s: `[DEMO VIDEO URL]`, `[ADDRESS, ~NOV 22]`, `[REPLAY FILE URL]`, `[APP URL]`, `[SERVICE URL]`, `[CONTACT EMAIL]`.
- **Price age** (SPEC §5.7) wherever a price or mark is shown: <60 min muted "Xm old"; ≥60 min amber "Gold price 3h old"; past max age (30 min crypto, 6 h gold) grey "Holding — price too old".
- **Times** in IST with "IST" written out. ₹ uses Indian grouping and is a display unit (`100000 × value / start`).
- **Data states** each data section handles: loading (skeleton / `loading.tsx`), not live yet, example, live, error (keep the section, link to the explorer, no estimates), stale price.
- **Layout:** works from 360 px with no horizontal scroll. Tables scroll inside `.scroll` boxes; the leaderboard drops optional columns under 600 px. Light and dark via `data-theme` on `<html>`.
- **Motion:** one playful personality (ease-out-back, 160/280/420 ms). Everything stops under `prefers-reduced-motion` (CSS kill switch plus JS checks in autoplay widgets and the mascot's eyes).
- **A11y:** real buttons and links; tabs use the ARIA tab pattern with arrow keys; scroll boxes are focusable with labels; decorative mascots are `aria-hidden`; the flip card uses `inert` on the hidden face.

## Pages

### `/` Home: "What is this and can I try it in 30 seconds?"
- **Sections:** hero (pitch + Mascot + TryBot above the fold) → How it works (6 steps, autoplay) → Coach it (5-step demo) → Proof (season countdown, latest trades, oracle prices) → Why blockchain (3 answers, SPEC §1.1) → Something happens every day (4 moments, EXAMPLE) → Where we actually are (works / next) → Next steps (try, demo, proof, code).
- **Flows:** example chip or submit → persona card (name, line, rules, 2 sliders) → Launch → first-trade card (EXAMPLE) or "holding" if the price is stale → "App opens ~Nov 25" (becomes "Make it for real" → `${APP_URL}/create?s=…` when `SITE_DATA_MODE=live`). Coach: Bad call → chip (4 variants change the v2 diff) → big move Allow/Shrink/Block → v2 diff (+1 row if blocked) → Approve → committed. Mascot click cycles 6 lines.
- **Data:** `getLatestTrades()`, `getOraclePrices()` (LIVE from QIE RPC today). TryBot uses live prices when the RPC answers, otherwise sample prices.
- **Copy rules:** the persona generator is labelled as a browser script, not the AI. "Where we actually are" is hand-updated copy; refresh it at each milestone.

### `/judges`: "Is it real, on mainnet, original, and does it use QIE properly?"
- **Sections:** sticky tour bar (Play 90 s / 6 step buttons / progress) → 1 What it is + hero v2 diff → 2 Contracts + latest trades → 3 QIE components (VERIFIED vs COMING) → 4 User-signed traction (empty until live) → 5 Why blockchain → 6 One sentence + Copy, repo, proof, demo poster.
- **Flows:** Play scrolls a section every 15 s (6 × 15 s = 90 s); a step button jumps there and pauses. Scrolling by hand updates the active step.
- **Data:** `getContracts()` (env), `getLatestTrades()`, `getActivity()`.
- **Constraints:** never show example traction numbers here.

### `/proof` (+ `/stats` → `/proof#stats`): "Is the record actually verifiable?"
- **Sections:** jump chips → 7 contracts → 5 feeds (real addresses, linked) + live oracle prices → oracle caveat (one QIE-operated wallet; measured gaps) + price-age legend → activity split (user-signed vs system) + latest trades → trust score rules (trust-v1) → replay (`npx botfolio-replay season-1.jsonl` + Copy).
- **Data:** env addresses, `@botfolio/shared` ASSETS, `getOraclePrices()`, `getActivity()`, `getLatestTrades()`.
- **Constraints:** system txs are never added to user numbers (SPEC §11).

### `/leaderboards` (S6): "Who's good?"
- **Sections:** season chips → 4 tabs: Top Returns · Best Risk-Adjusted · Most Trusted · Coach vs Bot. "Top human-raised bot" card (house bots never take it). House and NEW badges.
- **States:** not live ("No boards yet"); Best Risk-Adjusted empty state during 2-day sprint seasons; Most Trusted empty state; error.
- **Data:** `getLeaderboards(season)`.

### `/bot/[botId]` (S4): "Is this bot legit?"
- **Sections:** header (head, name, persona, id, version, owner + .qie COMING, ₹ value, season return) → holdings (weights, ₹, price + age) → trust score bars (F1–F4) → every call with its reason (TRADED / HELD / HELD · PRICE TOO OLD) → trades table (IST, size, oracle price, round, tx, OWNER-SIGNED) → versions (diff lines tied to corrections, config hash) → Replay this season.
- **States:** not found, not live, error, example.
- **Data:** `getBotRecord(id)` → `GET /api/v1/bots/:id/record`. Live holdings need `priceE8` and `priceAgeMin` (ask WS B to add them to the record payload).

### `/card/[cardId]` (S7): "A friend sent me this. Is it real?"
- **Sections:** title + CTA "Make a bot that beats mine" → flip card: front = share card (kind chip, headline, footer line, short tx), back = Verify on QIE (each cited tx + "what this proves") → Copy link.
- **Data:** `getCard(id)`. WS D owns the card payload (`packages/shared/cards.ts`) and the OG image at `/api/card/[cardId]`; switch this page's og:image to that once it exists.

### `/developers`: "Can I read a bot's track record from my own app or agent?"
- **Sections:** intro (COMING ~Nov 25) → Agent demo (scripted, EXAMPLE) → API curl + example JSON → MCP tools table + client config.
- **Constraints:** read-only, 60 req/min/IP (SPEC §10.1). Replace the example JSON with a real snapshot once live.

### `/about` (S9): "Is this gambling or advice?"
- **Sections:** three rules (play money, not advice, no prizes) → what we store → what on-chain means → FAQ (₹ maths, who sets prices, real money) → contact placeholder.
