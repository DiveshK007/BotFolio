# BotFolio — Final Build Spec (v1.1)

**Product name:** BotFolio (capital F). Used throughout this document.
**Event:** QIE Hackathon 3.0 (Mainnet Edition). Submission deadline **23:59 CET, Nov 30 2026 = 04:29 IST, Dec 1 2026**. Target: submit by the evening of Nov 30 (IST).
**Spec date:** v1.0 Nov 19 2026; v1.1 Nov 20 2026, IST. All times in this document are IST (UTC+5:30) unless marked otherwise.
**Rule for this doc:** anything not verified against a live source is marked **UNVERIFIED**. Verification sources are listed in §0.
**Build tooling:** the team builds with Claude Code. Repo conventions, workstream ownership and per-workstream starting prompts are in §16; the repo root `CLAUDE.md` mirrors the rules.

## v1.1 changelog (what changed from v1.0 and why)

| # | Change | Sections | Why |
|---|---|---|---|
| 1 | **Sprint seasons**: 2-day seasons from Nov 26 to Dec 5, weekly from Dec 7. Launch-period trust threshold lowered to 8 trades + 1 completed season | §1, §2.3, §6.1, §7, §8 | With weekly seasons, at most one season would close before demo week and the Most Trusted board would be empty for judges. Sprint seasons give 2 closed seasons before submission and 4 by the end of demo week |
| 2 | **More user-signed actions**: Approve Big Move (the user's signature *is* the trade), Daily Call (you vs your bot, settled by the oracle), Challenge link (bot vs bot, no stakes) | §2.2, §2.5, §4.3, §4.7, §4.8, §11 | In v1.0 almost every tx came from the runner. Judges can filter that on the explorer. These make users sign real, frequent mainnet txs |
| 3 | **QIE components moved into core**: Connect QIE Wallet login, `.qie` names, QIE Wallet MCP (reads) + BotFolio's own read-only MCP/API, optional QIE Pass "verified human" badge | §0.6, §2.6, §10, §13 | Mainnet Integration is 15% and multi-component use gets bonus scoring. v1.0 used Oracles only |
| 4 | **"Why blockchain" made concrete**: Verify-on-QIE link on every card, public record API + MCP server so other apps/agents can read a bot's record, portable records | §1.1, §9, §10 | The weakest pitch question. The record must be useful outside the app |
| 5 | **Something happens every day**: hold lines with personality, daily recap card at 21:30, live "thinking" feed between slots | §2.2, §9 | 4 slots × 5 assets means many quiet days; roast cards alone (≥3% loss) are too rare to drive return visits |
| 6 | **Innovation framing**: lead with coaching + provable version history (the v2 diff), not "AI paper trading" | §1.1, §13 | Competitors (Strategy Arena, pip.world, Botsfolio, Alpha Arena) already do AI paper trading. Coaching with on-chain versions is the new part |
| 7 | **Build plan replaced** with a 4-workstream team plan and Claude Code conventions | §12, §16 | Team build, not solo |
| 8 | **Review fixes (Nov 20, before interface freeze):** per-order replay key `orderId`; runner-signed Daily Call bot view; `setLimits` bounded like `createBot`; relay auth via Privy **or** SIWE JWT; Daily Call settle retries to 23:50 + next 09:00; bot-view fallback for late bots; 8 card kinds in schema; S6 shows all 4 boards; contract-derived challenge codes; users 18+; fork tests on rpc3 | §3, §4.2–§4.8, §6.4–§6.4.1, §11, §14, §16.3 | External review found these before contracts were frozen (#194) |
| 9 | **Same review, leftovers:** §6.1 Daily Call settle cron matches the 10-min retry through 23:50 IST plus the next 09:00, and skips instead of reverting; owners filled from `CLAUDE.md`; §10 env lists the browser-visible addresses plus relay JWT config; short challenge links resolve to the full code via the DB/indexer | §2.5, §4.3, §4.8, §6.1, §10, §11, §12.1, §15 | Those spots still described the pre-fix behaviour |
| 10 | **`users.terms_accepted_at`:** `timestamptz not null`, written at the one-line 18+ and Terms confirmation | §3, §11 | §11 required the confirmation; the users table had no column for it |
| 11 | **Local mainnet-fork staging** in `docs/anvil-fork.md`. `foundry.toml` adds an `anvil` endpoint at `http://127.0.0.1:8545` and drops `qie_testnet` (nothing referenced it) | §0.1, §4.10, §12.1, §12.3, §16 | Testnet staging was dropped Nov 20 (`docs/decisions.md`); the repo still listed a testnet RPC and had no fork runbook |
| 12 | **§0.6 re-checked Nov 20 2026:** QIE Wallet connect live; `.qie` names live via id.qie.digital; Wallet MCP live, free, and read-only; QIE Pass still UNVERIFIED (partner portal). `signTypedData` stays open in #189, so components that depend on it stay COMING | §0.6, §2.6, §10, §14 | The section header still said every component was UNVERIFIED |

---

## 0. Verified facts (checked Nov 19 2026, 14:30–14:50 IST)

### 0.1 QIE mainnet chain

| Item | Value | How verified |
|---|---|---|
| Chain ID | **1990** (`0x7c6`) | `eth_chainId` on rpc1–rpc5 all returned `0x7c6`; [QIE wallet guide](https://docs.qie.digital/qie-wallet-integration-guide-for-websites), [qie.digital/developers](https://www.qie.digital/developers) |
| RPC | `https://rpc1mainnet.qie.digital` (primary) and `rpc2`…`rpc5mainnet.qie.digital` (failover) | All 5 answered. rpc1 and rpc2 each dropped TLS handshakes intermittently during testing → **always configure failover** |
| Explorer | `https://mainnet.qie.digital` (Blockscout-style API at `/api` and `/api/v2` answered) | `api?module=block&action=eth_block_number` and `/api/v2/addresses/<oracle>` returned data |
| Native token | QIE, **18 decimals** | QIE docs + qie.digital network card |
| EIP-1559 | **Yes.** Blocks carry `baseFeePerGas` (1 gwei); `eth_feeHistory` and `eth_maxPriorityFeePerGas` (0.125 gwei) work; `eth_gasPrice` ≈ 1.125 gwei | RPC calls |
| EVM version | **Shanghai yes, Cancun NO.** `PUSH0` executes; `TSTORE`/`TLOAD` (0x5c/0x5d) and `MCOPY` (0x5e) fail with "invalid opcode" | `eth_call` with hand-written initcode |
| RIP-7212 P-256 precompile (0x100) | Returns empty → treat as **absent** | `eth_call` to `0x…0100` |
| Block time | ~3.6 s (100-block average) | timestamps of latest vs latest-100 |
| Block gas limit | `0xffffffff` | latest block |
| Client string | "Version dev, Go 1.22.2" (geth/cosmos-style; exact stack UNVERIFIED) | `web3_clientVersion` |
| Testnet | chain 1983, `https://rpc1testnet.qie.digital`, explorer `testnet.qie.digital`, faucet `qie.digital/faucet` | hackathon quickstart |

**Staging** is a local mainnet fork: [`docs/anvil-fork.md`](docs/anvil-fork.md) (decision Nov 20, `docs/decisions.md`). The testnet row is a verified fact about QIE. BotFolio staging uses the fork.

**Hard consequence for the build:** compile every contract with `evmVersion = "shanghai"` and solc 0.8.24. Do **not** rely on EIP-7702 or ERC-4337 smart-account modes from wallet SDKs (no Cancun/Prague, no QIE bundler or paymaster live).

### 0.2 QIE oracle feeds (Chainlink AggregatorV3 interface)

Read live via `eth_call` (`decimals()`, `description()`, `latestRoundData()`, `getRoundData()`) at ~14:40 IST Nov 19. Feed contracts are verified on the explorer as `AggregatorV3` (creator `0x00B842E95e213dF96B3cc12817432A82F2A85AF0`). Docs: [How to integrate QIE Oracle](https://docs.qie.digital/qie-oracle/developer-guide/how-to-integrate-qie-oracle-in-smart-contracts).

| Asset | Address | description() | Decimals | Status in BotFolio | Live age at check | Update gaps measured |
|---|---|---|---|---|---|---|
| BTC | `0x9E596d809a20A272c788726f592c0d1629755440` | BTC / USDT | 8 | **ON** | 0.8 min | median 10.5 min, max 104 min (last 25 rounds) |
| ETH | `0x4bb7012Fbc79fE4Ae9B664228977b442b385500d` | ETH / USDT | 8 | **ON** | 2.8 min | median 8 min, max 46 min (last 40) |
| XRP | `0x804582B1f8Fea73919e7c737115009f668f97528` | XRP / USDT | 8 | **ON** | 3.8 min | median 9 min, max 144 min (last 40) |
| SOL | `0xe86999c8e6C8eeF71bebd35286bCa674E0AD7b21` | SOL / USDT | 8 | **ON** | 3.8 min | median 12 min, max 84 min (last 40) |
| Gold (XAUt) | `0x9aD0199a67588ee293187d26bA1BE61cb07A214c` | Gold / USD | 8 | **ON** (6 h max age) | 126.8 min | median 78 min, max 552 min; 5 of 19 gaps > 2 h; at least one > 6 h |
| QIE | `0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17` | QIE / USDT | 8 | **OFF** | 1,494.8 min | — |
| BNB | `0x775A56117Fdb8b31877E75Ceeb68C96765b031e6` | BNB / USDT | 8 | **OFF** | 156.8 min | — |

Caveats (must be reflected in copy and UX):
- One QIE-operated wallet pushes all updates. Public wording: **"settled against QIE's official mainnet oracle."** Never "trustless" or "decentralised".
- Crypto feeds are quoted in **USDT**, gold in **USD**. Label them so.
- Freshness thresholds (**30 min crypto, 6 h gold**) will still reject some slots: crypto feeds occasionally go 45–144 min without a new round, and gold occasionally exceeds 6 h (one 9.2 h gap in the sample). This is expected behaviour, handled by §5 (skip-and-hold, never an error). Because gold prices can be hours old, the UI always shows a **price age label** (e.g. "Gold price 3h old").

### 0.3 ERC-2771 forwarder on QIE

- OpenZeppelin `ERC2771Forwarder` **v5.0.2** compiled with solc 0.8.24, `evmVersion: shanghai`, optimizer 200: deployment simulated with `eth_call` on mainnet → returned runtime bytecode (3,855 bytes). `eth_estimateGas` for deployment: **899,309 gas** (≈ 0.001 QIE at 1.125 gwei). → **Deployable.**
- OpenZeppelin **v5.6.1** (latest at check) `ERC2771Forwarder` requires `pragma ^0.8.24` and its dependency `utils/Bytes.sol` uses the `mcopy` opcode: it **fails to compile for Shanghai**, and a Cancun build would hit invalid opcode `0x5e` at runtime on QIE. → **Pin `@openzeppelin/contracts@5.0.2`** for all contracts.

### 0.4 Embedded / passkey wallet providers on custom chain 1990

All of these sign with a standard secp256k1 EOA key, so they work on any EVM chain as signers; none of their own gas-sponsorship features will work on QIE. We only need: passkey login, an embedded EOA, `signTypedData` (EIP-712) on chain 1990.

| Provider | Custom chain 1990 | Passkey | Notes | Verdict |
|---|---|---|---|---|
| **Privy** | Yes: `defineChain` (viem) passed as `defaultChain` + `supportedChains` ([docs](https://docs.privy.io/basics/react/advanced/configuring-evm-networks)) | Yes: `useLoginWithPasskey` ([docs](https://docs.privy.io/authentication/user-authentication/login-methods/passkey)) | Next.js-native React SDK. Don't enable Privy smart wallets (needs bundler/paymaster) | **Recommended** |
| **thirdweb in-app wallet** | Yes: `defineChain({ id: 1990, rpc })` ([docs](https://portal.thirdweb.com/references/typescript/latest/defineChain)) | Yes: `strategy: "passkey"` with `hasStoredPasskey` ([docs](https://portal.thirdweb.com/references/typescript/latest/inAppWallet)) | Don't use `executionMode` EIP7702/EIP4337 (QIE lacks both) | **Fallback** |
| Dynamic | Yes: `overrides.evmNetworks` ([docs](https://www.dynamic.xyz/docs/react/chains/adding-custom-networks)); "all EVM networks" send & sign ([docs](https://www.dynamic.xyz/docs/embedded-wallets/chains/overview)) | Passkey is mostly an auth/recovery add-on after email OTP | Gasless only on chains with Dynamic relayers | OK, not first choice |
| Web3Auth (MetaMask Embedded Wallets) | Yes: `CHAIN_NAMESPACES.EIP155` custom `chainId`/`rpcTarget` ([docs](https://docs.metamask.io/embedded-wallets/sdk/react-native/advanced/)) | Passkey support UNVERIFIED in this check | Social-login first | Not chosen |
| Turnkey | Yes: chain-agnostic EVM signing incl. EIP-712 ([docs](https://docs.turnkey.com/features/networks/ethereum)) | Yes, passkey-native ([docs](https://docs.turnkey.com/features/authentication/passkeys/integration)) | More plumbing (org/sub-org setup) | Backup if both above fail |

Free-tier limits/pricing for Privy and thirdweb: **UNVERIFIED** — check dashboards on Day 1. Passkey **sign-up** (not just login) flow on mobile Safari/Chrome: **UNVERIFIED** until the Day-1 spike.

### 0.5 Hackathon rules (from [hackathon.qie.digital](https://hackathon.qie.digital/) and [/terms](https://hackathon.qie.digital/terms))

See §13 for the checklist. Key wording, quoted:
- Mandatory submission (FAQ): *"All submissions must include: mainnet deployment, open-source smart contracts, live public app, public repository, demo video, documentation, and team presentation."*
- Form fields (quickstart step 5): *"GitHub repository, live demo URL, deployed contract address, and the hackathon track."*
- Mainnet (FAQ): *"Yes. Testnet-only projects are not eligible. Judges verify contracts, transactions, deployment, and frontend connectivity on QIE Mainnet."*
- Payouts (FAQ): *"Winners receive 50% immediately on Dec 10, 2026. The remaining 50% is paid after meeting any 3 traction milestones within 90 days."*
- Milestones (Prizes): *"Milestones include wallet growth, transaction volume, recurring users, merchants, active monthly usage, and revenue generation."* No numeric thresholds are published (UNVERIFIED whether thresholds exist privately).
- Judging weights (FAQ): *"Innovation 30%, Technical Quality 25%, User Experience 15%, Mainnet Integration 15%, and Business Potential 15%."* (The /terms page lists a different, older split: Innovation 25 / Technical 25 / Impact 25 / Presentation 25. Optimise for the FAQ split; it is the Hackathon 3.0 copy.)
- Bonus: *"Projects integrating multiple QIE components (QIE Wallet, QIE, QIE ID, QIEDEX, Oracles) receive additional scoring consideration."*
- AI use (FAQ): *"Yes, AI-assisted development is encouraged. Teams must fully understand and maintain their code and be able to explain architecture to judges."* Disqualifiers include forked/recycled code, copied projects, simple clones, AI-generated projects with minimal developer contribution, no working demo.
- Terms: 18+, **must have a valid QIE wallet address**, one submission per team, original work created during the hackathon period, prizes paid in QIE tokens.

### 0.6 Extra QIE components (added v1.1 — re-checked Nov 20 2026)

Checked Nov 20 2026. QIE Wallet `signTypedData` on chain 1990 is still to be tested in #189. Components that depend on that signature stay **COMING** until then. WS D copies these results into `docs/qie-components.md` when #189 is done.

| Component | Status (Nov 20 2026) | What we use it for | Source | Fallback if it fails |
|---|---|---|---|---|
| **QIE Wallet** (browser extension / mobile) | Connect is **LIVE**. Signing the EIP-712 forwarder requests needs `signTypedData` on chain 1990, still open in #189, so that path stays **COMING** | Second login option: "Connect QIE Wallet". User signs the same EIP-712 forwarder requests; relayer still pays gas | [QIE wallet integration guide](https://docs.qie.digital/qie-wallet-integration-guide-for-websites). Connect checked Nov 20 2026. `signTypedData_v4` on 1990: still to test (#189) | Generic injected-wallet (EIP-1193) connect; still label "QIE Wallet" only if it actually is |
| **QIE ID / `.qie` names** | **LIVE** at [id.qie.digital](https://id.qie.digital). Showing a name does not need `signTypedData` | Show `name.qie` instead of `0x…` on bot pages, leaderboards and cards | https://id.qie.digital (checked Nov 20 2026) | Show short address; hide the name slot |
| **QIE Wallet MCP** | **LIVE**, free, read-only at https://mcp.qie.digital/mcp | Server-side reverse lookups and balance/tx-status reads for the `/proof` page | https://mcp.qie.digital/mcp (checked Nov 20 2026): read-only tools for balances, tx status, tokens, network info, QIE ID resolve, reverse lookup | Direct RPC + explorer API reads |
| **QIE Pass** | **UNVERIFIED** for us. Requires a partner portal; partner access is not confirmed | Optional "verified human" badge on leaderboards (anti-sybil). Never gates the core loop | Partner REST API with HMAC auth; user approves request in QIE Wallet; claim within 24 h. Users need a purchased QIE ID to finish KYC | Ship without the badge; mention as roadmap in the deck |

---

## 1. Overview

**One-liner (judges):** Raise an AI trader in one sentence, coach it every season, and let QIE keep score.

**Main line (users):** Raise an AI trader in one sentence. ₹1 lakh of play money, zero risk, and every trade on the blockchain so nobody can fake it.

**Differentiation:** Others let coders enter bots or let you watch famous AIs trade. BotFolio lets anyone raise a bot in one sentence, coach it every season, and prove its record on QIE mainnet with play money.

**Taglines:**
- Your AI trader. Your rules. Your fault. (X favourite)
- No fake screenshots. Every trade on-chain.
- Think you can beat AI at trading? Build one and find out.
- It's Pokémon, but your Pokémon trades Bitcoin.
- Sharma ji's son trades manually. Yours has a bot. (CIT WhatsApp groups)

**Viral engine:** the roast card on losses, e.g. "AlphaWolf lost ₹12,400 going all-in on gold at 2 AM. Trust score 312. Roast him." Every card links to the bot's on-chain record.

**Locked product rules**
- Play money only. Every bot starts with the same **₹1,00,000 play capital**. No token, no NFTs, no entry fees, no stakes, no prizes, no real-asset buy links (India: Promotion and Regulation of Online Gaming Act 2025 — no money games).
- Assets: **BTC, ETH, SOL, XRP, Gold + cash**. Long or cash only. No shorting, no leverage. QIE and BNB off.
- Decisions **4×/day at 09:00, 13:00, 17:00, 21:00 IST**.
- **Seasons (v1.1):** *Sprint seasons* during launch and judging, then weekly. Season boundaries live in the `seasons` table (config, not code):

  | Season | Opens | Last slot | Closes | Type |
  |---|---|---|---|---|
  | S0 (test, hidden) | Nov 27 00:00 | Nov 28 21:00 | Nov 28 21:30 | sprint |
  | S1 | Nov 29 00:00 | Nov 30 21:00 | Nov 30 21:30 | sprint |
  | S2 | Dec 1 00:00 | Dec 2 21:00 | Dec 2 21:30 | sprint |
  | S3 | Dec 3 00:00 | Dec 4 21:00 | Dec 4 21:30 | sprint |
  | S4 | Dec 5 00:00 | Dec 6 21:00 (Sun) | Dec 6 21:30 | sprint |
  | S5+ | Mon Dec 7 00:00 | Sun 21:00 | Sun 21:30 | weekly |

  Re-seeded Nov 26 (`docs/decisions.md`): the contracts deploy ~Nov 27–28 and `SeasonLedger` opens S(n+1) only after S(n) closes, so no season may start before the deploy. Result: S1 closes Nov 30 21:30, before the submission deadline (04:29 IST Dec 1); S2–S4 close during demo week, so judges see live season results.
- **Launch threshold (v1.1):** until S5 starts, "provisional" = fewer than **8** executed trades or **0** completed seasons. From S5 it reverts to 20 trades / 1 season (§7). Store the active threshold in `trust_rules_version` so old scores stay reproducible.
- Example prompts are crypto/gold only (QIE has no stock feeds).
- Hackathon track: **AI + Autonomous Agents** (locked).
- LLM: **Grok via the xAI API** behind a provider-agnostic interface (§6.6). Hosting: **Render** for the worker + relayer (§10).

### 1.1 Pitch answers (v1.1)

**Lead with what's new.** AI paper trading exists (Strategy Arena, pip.world, Botsfolio, Alpha Arena). What nobody does: *you coach your bot, and every version of its brain is committed on-chain, so its record shows how it learned from you.* The hero moment in every demo and deck is the **v2 diff**: "You said 'too risky' 3× → max per coin 40% → 25% · config hash on QIE."

**"Why blockchain? Why not a database?"** — three answers, each backed by a feature:
1. **Anyone can check, not just us.** Every share card has a *Verify on QIE* link (§9). A screenshot can be faked; the trade tx, the oracle round it priced against and the version hash can't.
2. **Other apps and agents can read the record.** A public read API and a BotFolio MCP server (§10.1) let any app or AI agent fetch a bot's verified track record straight from chain data.
3. **The record outlives the app.** The bot, its trades and its versions belong to the owner's address. If BotFolio shut down tomorrow, the history stays on QIE and the replay script still recomputes it.

---

## 2. User flows

### 2.1 Newcomer path (< 30 s, landing → first trade)
1. **Landing** (0 s): headline + one input "Describe your bot in one sentence" with 3 tap-to-fill examples ("Careful like my dad, loves gold", "YOLO Bitcoin maxi, never sells", "Buys dips on SOL and XRP, takes profit fast").
2. **Tap "Make my bot"** → passkey sheet (Face ID / fingerprint). Embedded wallet is created silently. No seed phrase, no network prompt, no gas (target ≤ 8 s).
3. **Bot card appears** (LLM persona call ≤ 5 s, streamed): name, emoji avatar, personality line, plain-words rules, and **2 sliders** pre-set by the LLM: *Max per coin* (10–50 %, step 5) and *Max trades per day* (1–8). User can drag or accept.
4. **Tap "Launch"** → one EIP-712 signature (passkey) → relayer submits `BotRegistry.createBot` via forwarder (≤ 4 s on a 3.6 s chain).
5. **First trade** immediately: runner runs an out-of-schedule "debut" decision for that bot → `PaperLedger.executeBatch` reads oracles on-chain → card shows "Bought ₹25,000 of Gold at $3,730.84 (QIE oracle round 14811) · View on explorer".

Stopwatch target ≤ 30 s total; measured on Nov 27 with 20 people (§12).

### 2.2 Daily
- Notification channel = in-app feed + optional web push (PWA) — if push slips, the feed + email-free "come back" share cards are enough.
- After each slot the bot posts a one-line plain-words reason + a roast line for losses.
- **Holds have personality (v1.1):** a HOLD decision still produces a one-line, persona-voiced reason ("AlphaWolf is sulking in cash after Tuesday's gold mess"). Never show a blank slot.
- **Thinking feed (v1.1):** between slots, `/me` shows the bot's latest one-liners and a countdown to the next slot ("Next call in 2h 14m · watching SOL"). Cheap: reuses the last decision's text plus live oracle prices; no extra LLM calls.
- **Daily recap card (v1.1):** at 21:30 IST each day, one card per bot: today's value change, best/worst call, rank in the current season. This is the guaranteed daily shareable, even on quiet days.
- **Correct a call:** on any decision, one tap "Bad call" (+ optional one-line reason, ≤ 80 chars, or pick a chip: "too risky", "too timid", "wrong coin", "sold too early"). Signed via passkey and relayed to `SeasonLedger.recordCorrection` (cheap, gives a unique user signer per coaching action).
- **Approve Big Move (v1.1, user-signed trade):** if the bot wants a big move — a BUY that would put **≥ 30 %** of portfolio value into one asset, or a SELL of **≥ 50 %** of a holding — the order is not auto-executed. The owner gets "AlphaWolf wants to put 35 % in Gold. Allow?" with Allow / Shrink to safe size / Block.
  - **Allow** → the user's passkey signs; the relayer submits `PaperLedger.executeApproved` through the forwarder. The user-signed tx itself reads the oracle and executes the trade (§4.3).
  - **Shrink / no answer within 2 h** → runner executes a clipped version (below the threshold) in its next batch.
  - **Block** → recorded as a correction with chip "blocked" (feeds the season-close v2 proposal).
- **Daily Call (v1.1, user-signed):** once a day, "You vs your bot: BTC up or down by tonight's 21:00 slot?" The bot's own view is shown after the user picks. The user's tap signs `DailyCall.call(...)`; the contract records the oracle price at call time. Settlement reads the oracle at or after the 21:00 slot (§4.7). Streak and "You 4 – Bot 3 this season" scoreboard on `/me`. No stakes, no prizes.

### 2.3 Season close (sprint: every other day at 21:30; weekly from Dec 7: Sunday 21:30 IST)
1. Season close job marks all portfolios at the 21:00 slot prices.
2. Battle result: your bot vs 3 house bots (rank 1–4) + global leaderboards.
3. **v2 proposal:** LLM reads the week's corrections and the current strategy, proposes v2 (new rules text + slider changes, each change tied to a correction). User sees a diff: "You said 'too risky' 3 times → max per coin 40 % → 25 %."
4. User taps **Approve v2** (passkey) → `SeasonLedger.commitVersion(botId, version, configHash)` via forwarder. If not approved by 08:30 the next morning, the bot keeps the current version.
5. Share card generated (battle + season result).
6. If the user corrected nothing this season, the v2 proposal is still generated from the season's results (e.g. drawdown, worst call) so every active user gets an Approve moment.

### 2.4 Screen list (mobile-first PWA)
| # | Route | Screen |
|---|---|---|
| S1 | `/` | Landing + one-sentence input + examples |
| S2 | `/create` | Bot card preview + 2 sliders + Launch |
| S3 | `/me` | My bot: value in ₹, today's calls, correct-a-call, version, trust score |
| S4 | `/bot/[botId]` | Public bot page: balance, holdings, every decision and trade with reason, oracle roundId, tx + explorer links, versions with config hashes, trust score breakdown, "replay this season" link |
| S5 | `/season/[n]` | Season close: battle result, v2 diff, Approve |
| S6 | `/leaderboards` | Tabs: Top Returns · Best Risk-Adjusted (Sortino) · Most Trusted · Coach vs Bot |
| S7 | `/card/[cardId]` | Share card landing (OG image + CTA "Make a bot that beats mine") |
| S8 | `/proof` | How verification works, contract addresses, trust rules (versioned), replay instructions, oracle caveat |
| S9 | `/about` | Play-money / not-advice / no-prizes notice |
| S10 | `/challenge/[code]` | Challenge landing (v1.1): "Ravi's bot GoldGuru challenges yours" → make a bot or accept with an existing one |
| S11 | `/me/call` (sheet on S3) | Daily Call + Approve Big Move prompts (v1.1) |

### 2.5 Challenge links (v1.1, user-signed, no stakes)
- On `/me` or any share card: "Challenge a friend" → user signs `Challenges.create(myBotId, seasonId)` → link `/challenge/<code>`, where `<code>` is the first 8 bytes of the contract's `bytes32` code, hex-encoded.
- Friend opens the link → creates a bot (newcomer path §2.1, ≤ 30 s) or picks their existing bot. The app resolves that short code to the full code via the DB/indexer, then the friend signs `Challenges.accept(fullCode, theirBotId)`.
- Result is computed at season close from the same season returns (no extra trading). Battle card shows both bots + "Rematch next season?" (one tap = new signed challenge).
- No stakes, no prizes, no tokens. Recognition only. Max 10 open challenges per bot.

### 2.6 Login options (v1.1)
- **Passkey (default)** — Privy embedded wallet (§0.4).
- **Connect QIE Wallet** — for users who already have it (§0.6). Connect is live (Nov 20 2026). The EIP-712 signature path stays **COMING** until `signTypedData` is tested on chain 1990 (#189). Relayer still pays gas.
- Profile shows `name.qie` where reverse lookup returns one; otherwise a short address.

---

## 3. Data model (Postgres / Supabase)

Money units: **on-chain values are in "play USDT" with 8 decimals** (same scale as the feeds). The ₹ figure is a display unit: `displayINR = 100000 × value / startValue` (exact, deterministic). A tooltip shows "≈ X USDT; INR conversion approximate" using an off-chain USD/INR rate (cached daily). QIE has no INR feed.

```text
users(id uuid pk, wallet_address text unique, privy_did text, created_at, last_seen_at, flags jsonb)
bots(id bigint pk = on-chain botId, owner_wallet text, name text, emoji text, persona_text text,
     persona_hash bytea32, created_at, created_tx text, is_house bool, status enum(active,paused,banned))
bot_versions(bot_id, version int, rules_text text, max_per_coin_bps int, max_trades_per_day int,
     config_json jsonb, config_hash bytea32, source enum(create,season_v2), committed_tx text,
     approved_at, pk(bot_id,version))
slots(id pk, slot_time timestamptz, kind enum(scheduled,debut), season_id)
oracle_reads(slot_id, asset enum(BTC,ETH,SOL,XRP,GOLD), feed text, round_id numeric, answer numeric,
     updated_at timestamptz, fresh bool)
decisions(id uuid pk, bot_id, version, slot_id, prompt_version text, model text, input_json jsonb,
     input_hash bytea32, raw_output_json jsonb, output_hash bytea32, gate_result jsonb,
     reason text, reason_tag text, roast text, status enum(executed,held,skipped_stale,invalid), created_at)
trades(id pk, decision_id, action_index int, order_id bytea32, bot_id, asset, side enum(BUY,SELL), cash_e8 numeric, units_e18 numeric,
     price_e8 numeric, round_id numeric, tx_hash text, log_index int, block_number bigint)
portfolio_marks(bot_id, slot_id, cash_e8, holdings jsonb, value_e8, pk(bot_id,slot_id))
corrections(id pk, bot_id, decision_id, user_wallet, chip text, note text, note_hash bytea32, tx_hash, created_at)
seasons(id int pk, starts_at, ends_at, status enum(open,closing,closed), data_root bytea32,
     data_uri text, root_tx text, trust_rules_version text, scores_root bytea32, scores_tx text)
season_results(season_id, bot_id, start_value_e8, end_value_e8, return_bps int, sortino numeric,
     max_dd_bps int, trades int, battle_rank int, pk(season_id,bot_id))
trust_scores(season_id, bot_id, rules_version, f_rules int, f_drawdown int, f_consistency int,
     f_explains int, total int, provisional bool, leaf_hash bytea32)
cards(id text pk, bot_id, kind enum(trade,roast,battle,season,recap,evolution,challenge,call), payload jsonb, created_at)
relay_log(id pk, user_wallet, target text, selector text, status, tx_hash, gas_used, created_at)
-- v1.1
seasons: + kind enum(sprint,weekly), + provisional_min_trades int   -- 8 during sprint, 20 from S5
big_moves(id pk, decision_id, action_index int, order_id bytea32, bot_id, asset, side, bps int, runner_sig bytea, deadline timestamptz,
     status enum(pending,approved,shrunk,blocked,expired), user_tx text, created_at)
daily_calls(id pk, bot_id, user_wallet, day int, asset, user_up bool, bot_up bool, bot_up_sig bytea, price_at_call_e8 numeric,
     round_at_call numeric, settle_price_e8 numeric, settle_round numeric, user_correct bool, bot_correct bool,
     call_tx text, settle_tx text)
challenges(code text pk, season_id, challenger_bot, opponent_bot null, create_tx text, accept_tx text,
     status enum(open,accepted,settled,expired), winner_bot null)
qie_names(wallet_address text pk, qie_name text null, checked_at)   -- cache of reverse lookups (24 h TTL)
users: + login_method enum(passkey,qie_wallet), + pass_verified bool default false, + pass_verified_at, + terms_accepted_at timestamptz not null
```
**Order IDs (v1.1 fix):** one decision can hold up to 3 actions, so replay protection is per order, not per decision: `orderId = keccak256(abi.encode(decisionId, actionIndex))`, where `actionIndex` is the action's position in the decision's `actions` array (0-based).

**18+ / Terms (v1.1):** `users.terms_accepted_at timestamptz not null` is set at sign-up, when the user confirms they are 18+ and accept the Terms (§11). Every user row carries that timestamp.

**Public read surface:** the web reads only Postgres *views* (defined in `schema.sql`, anon-readable under RLS). Base tables — especially `users`, `relay_log`, `big_moves.runner_sig`, `daily_calls.bot_up_sig` — are never anon-readable (§11).

Indexer source of truth = chain events; `trades`, `bots`, `bot_versions.committed_tx`, `corrections.tx_hash` are written only from indexed events (plus optimistic UI rows marked pending).

---

## 4. Smart contracts

Common: Solidity 0.8.24, `evmVersion: shanghai`, OpenZeppelin **5.0.2**, Foundry. All verified on `mainnet.qie.digital`. All original code except OZ libraries. User-facing contracts inherit `ERC2771Context(forwarder)` and use `_msgSender()`.

**On-chain per event vs batched**
| Data | Where | Why |
|---|---|---|
| Bot creation, persona hash, limits | per bot, `BotRegistry` (user-signed via forwarder) | ownership + unique signer |
| Every trade (asset, side, size, price, roundId) | **per trade, on-chain**, batched per slot in one tx by the runner | price is read by the contract from the oracle, so the trade record cannot be faked; enables explorer links per trade |
| HOLD / skipped decisions, LLM inputs/outputs, reasons | off-chain, included in the season data root | cheap; still provable via root |
| Corrections | per correction, `SeasonLedger` event only (user-signed) | habit proof + unique signers; note text stays off-chain (hash only) |
| Version config | per approved version, `SeasonLedger` (user-signed) | provable evolution |
| Season data root | 1 tx per season | seals all decisions + replay file |
| Trust scores | 1 Merkle root per season (+ optional daily) | cheap; anyone can recompute |

### 4.1 `BotForwarder`
`contract BotForwarder is ERC2771Forwarder { constructor() ERC2771Forwarder("BotFolio") {} }` — unchanged OZ logic (`execute`, `executeBatch`, `verify`, nonces, deadline). EIP-712 domain name "BotFolio", version "1", chainId 1990.

### 4.2 `BotRegistry`
Storage:
```solidity
struct Bot { address owner; bytes32 personaHash; uint16 maxPerCoinBps; uint8 maxTradesPerDay; uint32 version; uint64 createdAt; bool active; bool house; }
mapping(uint256 => Bot) public bots; uint256 public nextBotId = 1;
mapping(address => uint256) public botOf;        // MVP: 1 bot per wallet
```
Functions:
- `createBot(bytes32 personaHash, uint16 maxPerCoinBps, uint8 maxTradesPerDay) returns (uint256 botId)` — `_msgSender()` is owner; require `botOf[owner]==0`, `1000 ≤ maxPerCoinBps ≤ 5000`, `1 ≤ maxTradesPerDay ≤ 8`. Calls `PaperLedger.initPortfolio(botId)`. Owner implicitly authorises the runner to trade this bot (stated in the signed EIP-712 request; UI says so).
- `createHouseBot(bytes32 personaHash, uint16, uint8)` — `ADMIN_ROLE` only, `house=true`.
- `setLimits(uint256 botId, uint16, uint8)` — `SEASON_LEDGER` only (called from `commitVersion`). **Enforces the same bounds as `createBot`** (`1000 ≤ maxPerCoinBps ≤ 5000`, `1 ≤ maxTradesPerDay ≤ 8`) through one shared internal check, so no version can exceed them.
- `setActive(uint256 botId, bool)` — owner (pause) or `ADMIN_ROLE` (abuse ban).
Events: `BotCreated(botId, owner, personaHash, maxPerCoinBps, maxTradesPerDay)`, `BotLimitsChanged(botId, version, maxPerCoinBps, maxTradesPerDay)`, `BotActiveChanged(botId, active)`.

### 4.3 `PaperLedger` (trade log + play balances)
Storage:
```solidity
uint256 public immutable START_CASH_E8; // set in constructor: play USDT ≈ ₹1,00,000 / USDINR on deploy day (display uses the ₹ rule in §3)
enum Asset { BTC, ETH, SOL, XRP, GOLD }       // index 0..4
mapping(uint8 => address) public feed;          // fixed at deploy, only these 5
mapping(uint8 => uint32) public maxAge;         // 1800 s crypto, 21600 s (6 h) gold
struct Portfolio { uint128 cashE8; uint16 lastDay; uint8 tradesToday; bool init; }
mapping(uint256 => Portfolio) public portfolios;
mapping(uint256 => mapping(uint8 => uint256)) public unitsE18;  // holdings
```
Functions:
- `initPortfolio(uint256 botId)` — `REGISTRY` only; cash = `START_CASH_E8`.
- `executeBatch(Order[] calldata orders)` — `RUNNER_ROLE` only. `struct Order { uint256 botId; uint8 asset; bool buy; uint16 bps; bytes32 decisionId; uint8 actionIndex; }`. `orderId = keccak256(abi.encode(decisionId, actionIndex))` (§3). Per order:
  0. `usedOrder[orderId] == false`, else emit `OrderSkipped(…, USED)` and continue.
  1. bot active; `asset ≤ 4`.
  2. `(roundId, answer, , updatedAt, ) = AggregatorV3(feed[asset]).latestRoundData()`; require `answer > 0` and `block.timestamp - updatedAt ≤ maxAge[asset]`. **Stale → emit `OrderSkipped(botId, asset, decisionId, actionIndex, reason=STALE)` and continue** (never revert the batch).
  3. Day counter in IST (`(block.timestamp + 19800) / 86400`); enforce `tradesToday < maxTradesPerDay`.
  4. BUY: `cash = portfolio.cashE8 × bps / 10000`; post-trade position value ≤ `maxPerCoinBps` of portfolio value at current prices (reads other feeds' latest answers; if any held asset is stale, use its last answer for the cap check only). `units = cash × 1e18 / answer`. SELL: `units = held × bps / 10000`; `cash = units × answer / 1e18`.
  5. Set `usedOrder[orderId] = true`; emit `Trade(botId, asset, buy, cashE8, unitsE18, priceE8, roundId, updatedAt, decisionId, actionIndex)`.
- Views: `portfolioValueE8(botId)`, `holdings(botId)`.
- **`executeApproved(ApprovedOrder calldata o, bytes calldata runnerSig)` (v1.1)** — called through the forwarder by the bot owner. `struct ApprovedOrder { uint256 botId; uint8 asset; bool buy; uint16 bps; bytes32 decisionId; uint8 actionIndex; uint64 deadline; }`; the runner signs the whole struct, so it signs this exact `orderId`.
  1. `_msgSender() == BotRegistry.bots(botId).owner`.
  2. `runnerSig` is a valid EIP-712 signature over `o` by an address with `RUNNER_ROLE` (domain "BotFolio PaperLedger", v1, chain 1990). This proves the bot proposed exactly this order.
  3. `block.timestamp ≤ o.deadline`; `usedOrder[orderId] == false` → set true (replay guard per order; the runner checks the same `orderId` before any clipped fallback). Counts toward `tradesToday`.
  4. Same oracle read, staleness and limit checks as `executeBatch` steps 2–4. Here a stale price **reverts** (the user can retry; the UI says "price too old — try again in a few minutes").
  5. Emit `Trade(...)` plus `ApprovedTrade(botId, decisionId, actionIndex, owner)`.
  Result: the user's own signed tx is the trade, priced on-chain by the oracle.
- `executeBatch` and `executeApproved` share `usedOrder[orderId]`, so a big move is never executed twice (approved by the user and clipped by the runner), while the other actions of the same decision still execute.
- No price is ever accepted as an input. No real tokens are held.
Events: `Trade(...)`, `ApprovedTrade(botId, decisionId, actionIndex, owner)`, `OrderSkipped(botId, asset, decisionId, actionIndex, uint8 reason)` (reasons: STALE, LIMIT, INACTIVE, ZERO, USED).

### 4.4 `SeasonLedger`
Storage: `mapping(uint256 => mapping(uint32 => bytes32)) configHash; struct Season { uint64 start; uint64 end; bytes32 dataRoot; string dataURI; bool closed; } mapping(uint32 => Season) seasons; uint32 public currentSeason;`
Functions:
- `commitVersion(uint256 botId, uint32 version, bytes32 hash, uint16 maxPerCoinBps, uint8 maxTradesPerDay)` — `_msgSender()` must be bot owner (or `ADMIN_ROLE` for house bots); `version == bots[botId].version + 1`; updates registry limits. Event `VersionCommitted(botId, version, hash, season)`.
- `recordCorrection(uint256 botId, bytes32 decisionId, bytes32 noteHash, uint8 chip)` — owner only; event `CallCorrected(botId, decisionId, noteHash, chip, season)`. Rate-limited off-chain; on-chain cap 20/day per bot.
- `openSeason(uint32 n, uint64 start, uint64 end)`, `closeSeason(uint32 n, bytes32 dataRoot, string dataURI)` — `COMMITTER_ROLE`. `openSeason` needs season `n - 1` closed; `closeSeason` needs `block.timestamp >= end` (#219). Events `SeasonOpened`, `SeasonClosed(n, dataRoot, dataURI)`.

### 4.5 `TrustScoreRegistry`
Storage: `mapping(bytes32 => string) rulesURI` (version → published rules doc URL + hash), `mapping(uint32 => bytes32) scoresRoot`, `mapping(uint32 => bytes32) rulesVersionOf`.
Functions: `publishRules(bytes32 version, string uri, bytes32 docHash)` (ADMIN), `commitScores(uint32 season, bytes32 rulesVersion, bytes32 root, string uri)` (COMMITTER; replaceable while the season is open, locked once SeasonLedger has it closed — #219), `verifyScore(uint32 season, uint256 botId, uint16 total, bytes32[] proof) view returns (bool)`. Leaf = `keccak256(abi.encode(season, botId, fRules, fDrawdown, fConsistency, fExplains, total))`. Events `RulesPublished`, `ScoresCommitted`.

### 4.6 Access control
OZ `AccessControl`. Roles: `DEFAULT_ADMIN_ROLE` = deployer cold key (hardware or separate wallet, never on the server); `RUNNER_ROLE` = runner hot wallet; `COMMITTER_ROLE` = same worker, separate key; `RELAYER` has **no role** — it only calls the forwarder. Feeds and maxAge are fixed at deploy (no setter) to show judges prices cannot be swapped; if a feed address changes, redeploy `PaperLedger` (documented). `DailyCall` uses the same fixed feed addresses as `PaperLedger`.

### 4.7 `DailyCall` (v1.1)
Storage: `struct Call { bool userUp; bool botUp; int256 priceAtCall; uint80 roundAtCall; uint64 calledAt; bool settled; bool userCorrect; bool botCorrect; }` `mapping(uint256 botId => mapping(uint32 day => Call)) calls;` Day = IST day number (`(block.timestamp + 19800) / 86400`). Asset fixed to BTC for MVP (most reliable feed, §0.2).
Functions:
- `call(uint256 botId, bool userUp, bool botUp, bytes calldata botSig)` — via forwarder; `_msgSender()` must be bot owner; not for an admin-banned bot (a paused one may call, #219); one call per bot per IST day; must be before 20:00 IST that day (so there's ≥ 1 h to the 21:00 settle). Reads BTC `latestRoundData()` (max age 30 min, else revert "price too old") and stores price + roundId. `botUp` is the bot's view, shown to the user only after they pick. **`botSig` must be a valid EIP-712 signature by a `RUNNER_ROLE` key over `(botId, day, botUp)`** (domain "BotFolio DailyCall", v1, chain 1990), else revert — so a user can't choose the bot's answer and rig the Coach vs Bot board. Event `Called(botId, day, userUp, botUp, price, roundId)`.
- `settle(uint256[] botIds, uint32 day)` — `COMMITTER_ROLE`, run at the 21:00 slot; reads BTC `latestRoundData()` (must be fresh and `updatedAt` ≥ that day's 21:00 IST, else **skip, don't revert**). The worker retries every 10 min until 23:50 IST, then once more at the next 09:00 slot, because BTC sometimes goes 45–104 min without a new round (§0.2). The app shows "Settles late" meanwhile. From 21:00 IST the next day (`SETTLE_WINDOW`, 24 h) `settle` always skips that day, so an unsettled call is void (#219). Sets `userCorrect = (price > priceAtCall) == userUp`, same for bot; equal price = no winner. Event `Settled(botId, day, price, roundId, userCorrect, botCorrect)`.
- Anyone can recompute settlement from `getRoundData`.

### 4.8 `Challenges` (v1.1)
Storage: `struct Challenge { uint256 challengerBot; uint256 opponentBot; uint32 season; uint8 status; }` `mapping(bytes32 code => Challenge)`; `openCount[botId] ≤ 10`.
Functions (all via forwarder, owner-only for the bot named):
- `create(uint256 myBot, uint32 season) returns (bytes32 code)` — the contract derives `code = keccak256(abi.encode(_msgSender(), nonce++))`, so nobody can front-run a client-chosen code; season must be open or next. Event `ChallengeCreated(code, myBot, season)`; the app reads the full code from the event. Share links use the first 8 bytes of `code`, hex-encoded. `accept` needs the full `bytes32`; the app resolves the short code to the full code via the DB/indexer (the indexer stores the event's code) before the friend signs.
- `accept(bytes32 code, uint256 theirBot)` — `theirBot ≠ challengerBot` and the two bots have different owners; status open. `openCount` drops when a challenge is settled or expires. Event `ChallengeAccepted(code, theirBot)`.
- `settle(bytes32 code, uint256 winnerBot)` — `COMMITTER_ROLE`, at season close, winner = higher season return (tiebreak lower maxDD), recomputable off-chain. Event `ChallengeSettled(code, winnerBot)`.

### 4.9 Contract list (v1.1)
`BotForwarder`, `BotRegistry`, `PaperLedger`, `SeasonLedger`, `TrustScoreRegistry`, `DailyCall`, `Challenges` — 7 contracts, all verified on `mainnet.qie.digital`, all listed on `/proof` and in the README.

### 4.10 Gas estimate approach
- Measure with `forge test --gas-report` on a mainnet fork (`--fork-url https://rpc3mainnet.qie.digital`, falling back to rpc4/rpc5) against the real feeds; then confirm with `eth_estimateGas` on mainnet before launch.
- Local staging (deploy the contracts onto a fork and point the apps at it): [`docs/anvil-fork.md`](docs/anvil-fork.md).
- Cost model: `cost_QIE = gasUsed × (baseFee 1 gwei + tip ~0.125 gwei)`. Reference point measured: forwarder deploy 899,309 gas ≈ 0.001 QIE.
- Budget formula for the relayer + runner float: `daily_gas ≈ bots × (4 slots × avg_orders × gas_per_order + corrections × gas_corr) + users_new × gas_create`. Per-order and per-call gas numbers come from the gas report (not estimated here). Keep ≥ 10 QIE float in each hot wallet (sizing UNVERIFIED until gas report); alert < 2 QIE.

---

## 5. Oracle pricing rules

1. Only the 5 whitelisted feeds, addresses in §0.2, fixed in `PaperLedger`.
2. Read `latestRoundData()` **inside the contract at execution time**. Off-chain reads are only for the LLM prompt and UI.
3. Validity: `answer > 0`, `updatedAt > 0`, `answeredInRound ≥ roundId` (if the feed returns 0 here, ignore this check — UNVERIFIED behaviour), `now − updatedAt ≤ 1800 s` (BTC/ETH/SOL/XRP) or `≤ 21600 s` = 6 h (Gold).
4. Stale at slot time → runner re-checks at +5, +10, +15 min; still stale → decision for that asset is recorded as `skipped_stale`, the bot **holds**, UI shows "Gold market quiet — holding" (not an error). The bot's other assets still trade.
5. Every trade stores `roundId`, `answer`, `updatedAt`, tx hash; the public page links the tx on `https://mainnet.qie.digital/tx/<hash>` and shows the roundId.
6. Marks (portfolio value, leaderboards) use the latest valid answer per asset at each slot, recorded in `oracle_reads` (with roundId) so marks are replayable via `getRoundData(roundId)`.
7. Display: "BTC $63,922.95 (USDT, QIE oracle round 50887, 1 min ago)". **Price age label is mandatory** wherever a price or a mark is shown: `< 60 min` → "Xm old" (muted); `≥ 60 min` → "Gold price 3h old" (amber); beyond the limit → "Holding — price too old" (grey, no trade).
8. QIE and BNB feeds are not wired at all.

---

## 6. AI runner

### 6.1 Schedule (one always-on Render service, cron expressions in **UTC**)
Render cron schedules are evaluated in UTC ([Render cron docs](https://render.com/docs/cronjobs)); IST = UTC+5:30. Use the same UTC expressions in the in-process scheduler (`node-cron` with `timezone: "UTC"`) so the two never disagree.

| Job | IST | UTC cron |
|---|---|---|
| Decision slots | 09:00, 13:00, 17:00, 21:00 daily | `30 3,7,11,15 * * *` |
| Stale retries | +5, +10, +15 min after each slot | `35,40,45 3,7,11,15 * * *` (only bots/assets still pending) |
| Season close check (v1.1) | daily 21:30 — closes any season whose `ends_at` slot has passed | `0 16 * * *` |
| Season open check (v1.1) | daily 00:00 — opens any season whose `starts_at` has arrived | `30 18 * * *` (18:30 UTC previous day) |
| Daily recap cards (v1.1) | daily 21:35 (after close check) | `5 16 * * *` |
| DailyCall settle (v1.1) | 21:00, then every 10 min until 23:50; once more at the next 09:00. No fresh price → skip, don't revert | `30,40,50 15 * * *`; `*/10 16-17 * * *`; `0,10,20 18 * * *` (every 10 min, 15:30–18:20 UTC); `30 3 * * *` (next 09:00) |
| Big-move expiry sweep (v1.1) | every 10 min — pending big moves past deadline → clipped order into next batch | `*/10 * * * *` |
| Indexer | continuous | 10 s loop in-process |

Season boundaries come from the `seasons` table (§1), so moving from sprint to weekly needs no code change.

- Debut decision on `BotCreated` event (within seconds) — needs the always-on process, which is why slots run in-process rather than only as Render Cron Jobs.
- Every job is idempotent, keyed by `slot_id`; a Postgres advisory lock prevents double runs.
- Optional safety net: a Render Cron Job (`$1/month` minimum) hitting `POST /internal/slot` with the same UTC schedule; the idempotency key makes a duplicate trigger a no-op.
- House bots run deterministic rules (no LLM) in the same slot.

### 6.2 Prompt contract (versioned `prompt-v1`)
System prompt fixed in repo (hash recorded). Input JSON (also hashed and stored):
```json
{ "slot": "2026-11-23T13:00:00+05:30", "bot": {"name":"AlphaWolf","persona":"...","rules":"...","max_per_coin_pct":25,"max_trades_per_day":4,"trades_today":1,"version":2},
  "portfolio": {"cash_pct":40,"holdings":[{"asset":"GOLD","pct":35,"avg_entry":3700.1}],"value_inr_play":103420},
  "market": [{"asset":"BTC","price":63922.95,"chg_24h_pct":-1.2,"chg_7d_pct":3.4,"fresh":true}, ...],
  "recent_corrections": [{"chip":"too risky","note":"stop going all in"}] }
```
Market change fields are computed from stored oracle rounds (no external price API).

### 6.3 Strict output schema (JSON Schema, used with the LLM's structured-output mode)
```json
{ "type":"object","additionalProperties":false,
  "required":["actions","reason","reason_tag","roast"],
  "properties":{
    "actions":{"type":"array","maxItems":3,"items":{"type":"object","additionalProperties":false,
      "required":["asset","action","pct"],
      "properties":{"asset":{"enum":["BTC","ETH","SOL","XRP","GOLD"]},
                    "action":{"enum":["BUY","SELL","HOLD"]},
                    "pct":{"type":"integer","minimum":0,"maximum":100}}}},
    "reason":{"type":"string","minLength":10,"maxLength":140},
    "reason_tag":{"enum":["trend_up","trend_down","buy_dip","take_profit","cut_loss","rebalance","persona_preference","coach_feedback","stay_cash"]},
    "roast":{"type":"string","maxLength":100}
  } }
```
`pct` = % of current cash for BUY, % of current holding for SELL. Empty `actions` = hold.
Persona creation call has its own schema: `{name ≤ 20, emoji, persona ≤ 120, rules ≤ 240, max_per_coin_pct 10–50 step 5, max_trades_per_day 1–8}`. v2 proposal schema: `{rules ≤ 240, max_per_coin_pct, max_trades_per_day, changes:[{what, because_correction_id}] ≤ 5}`.

### 6.4 Deterministic risk gate (pure function `gate(input, output, rulesVersion) → orders[]`)
1. Schema-validate; invalid → one retry; still invalid → `status=invalid`, hold.
2. Drop actions on stale assets.
3. Drop SELL with no holding, BUY with cash < 1 %.
4. Clip so trades this slot ≤ remaining `max_trades_per_day`.
5. Clip BUY so post-trade asset weight ≤ `max_per_coin_pct`.
6. No shorting/leverage by construction. Min order 1 % of portfolio.
7. Record each clip as a "gate event" (feeds trust factor F1).
8. Banned content filter on `reason`/`roast` (slurs, real-money advice phrases like "buy now on…") → replace with neutral text, flag.
9. **Big-move split (v1.1):** after clipping, any order meeting the big-move rule (§2.2: BUY → post-trade weight ≥ 30 %, or SELL ≥ 50 % of a holding) is removed from the batch and becomes a `big_moves` row: runner signs the `ApprovedOrder` (EIP-712), deadline = now + 2 h, user is notified. A big move is *not* a gate clip (no F1 penalty). House bots never produce big moves (they always execute directly).
10. **Expiry fallback (v1.1):** if the big move is still pending at its deadline, the runner shrinks it to just under the threshold, re-checks limits and freshness, and executes it in the next batch with the same `orderId` (contract blocks double execution; the decision's other actions are unaffected).

### 6.4.1 Bot's Daily Call view (v1.1)
At the 09:00 slot, the decision call also returns `daily_call: {"btc_up": bool, "why": string ≤ 80}` (add to the output schema as an optional field). The worker signs `(botId, day, btc_up)` with the runner key (§4.7) and serves view + signature to the app; the view is revealed to the user after they pick.
- **Bots created after 09:00 (v1.1 fix):** the debut decision also returns `daily_call`. If a bot still has no view for today, the app hides Daily Call and shows "Your bot joins tomorrow's call".

### 6.5 Determinism and replay (honest claim)
- LLM calls use temperature 0 (where the model accepts it) and a fixed, logged model id, but LLM output is **not** guaranteed reproducible. The claim is: *given the logged LLM output, everything after it is deterministic and recomputable.*
- Replay file per season (`season-<n>.jsonl`, canonical JSON, sorted keys): one line per decision with `input`, `input_hash`, `raw_output`, `output_hash`, `gate_result`, `orders`, oracle `roundId`s, and resulting tx hashes; one line per correction and mark.
- `dataRoot` = Merkle root (keccak256, sorted pairs) over line hashes; committed in `SeasonLedger.closeSeason` with the file URL (Supabase public storage; IPFS optional).
- `npx botfolio-replay season-3.jsonl` (script in repo): re-runs `gate()` on each logged output, re-reads `getRoundData(roundId)` from QIE, recomputes every balance, mark, leaderboard and trust score, and checks the root and on-chain `Trade` events match.

---

### 6.6 LLM provider: Grok via xAI (swappable)
- Default provider **xAI**, OpenAI-compatible base URL `https://api.x.ai/v1`, auth `XAI_API_KEY` ([quickstart](https://docs.x.ai/developers/quickstart)). Structured outputs via `response_format: {type: "json_schema", json_schema: {name, schema, strict: true}}`; xAI states responses are guaranteed to match supported schemas ([structured outputs](https://docs.x.ai/developers/model-capabilities/text/structured-outputs)). Keep schemas inside the supported subset (no circular `$ref`; set `additionalProperties: false` explicitly anyway).
- Model is config, not code: `LLM_MODEL_DECISION` (default `grok-4.20-0309-non-reasoning`, in the lowest-priced Grok 4.x tier on the pricing page) and `LLM_MODEL_PERSONA` / `LLM_MODEL_V2` (default the same; may set `grok-4.7` for v2 proposals). Whether the non-reasoning model honours `temperature: 0` exactly: UNVERIFIED — log the parameters sent either way.
- Interface (`packages/llm`): `interface LlmClient { complete<T>(req: { system: string; input: object; schema: JSONSchema; schemaName: string; model: string; temperature?: number; timeoutMs: number }): Promise<{ output: T; raw: string; model: string; usage: { inTok: number; outTok: number } }> }`. Implementations: `XaiClient` (default), `OpenAiClient`, `AnthropicClient`. Selected by `LLM_PROVIDER=xai|openai|anthropic`; swapping to Claude/GPT is an env change plus that provider's key. The rest of the runner only sees `LlmClient`.
- Timeouts 20 s, one retry on timeout/invalid JSON, then `status=invalid` → hold. Per-slot concurrency 10. Usage tokens logged per decision for cost tracking.
- **Cost model** (prices from [xAI pricing](https://docs.x.ai/developers/pricing), last updated Oct 10 2026): `grok-4.20-0309-non-reasoning` $1.25 / 1M input, $2.50 / 1M output; `grok-4.7` $2 / $6. Assuming ~1,500 input + ~150 output tokens per decision (estimate, measure on Day 4): ≈ $0.0023 per decision → ≈ $0.009 per bot per day (4 slots) → ≈ $0.28 per bot per month; 100 bots ≈ $28/mo, 1,000 bots ≈ $280/mo. Persona and season v2 calls add < 10 %. Enforce `LLM_MONTHLY_BUDGET_USD`: when 80 % is used, alert; at 100 %, bots fall back to the deterministic "hold" decision and the UI says "bot resting".

## 7. Trust score (`trust-v1`, 0–1000, published at `/proof` and on-chain via `publishRules`)

Computed over the bot's whole history up to the season close (all-time), integers, each factor 0–250. Total = F1 + F2 + F3 + F4.

| Factor | Definition | Formula |
|---|---|---|
| F1 Follows its rules | share of proposed actions that passed the risk gate unclipped | `250 × (1 − clipped_or_dropped_actions / max(1, proposed_actions))` (stale drops excluded) |
| F2 Drawdown control | max peak-to-trough drop of slot marks | `250 × max(0, 1 − maxDD / 0.30)` (30 % drawdown → 0) |
| F3 Consistency | volatility of daily returns (21:00 marks) | `250 × max(0, 1 − σ_daily / 0.04)`; needs ≥ 3 daily returns, else 125 |
| F4 Explains its trades | share of executed decisions whose reason passes a deterministic check: 10–140 chars, names the traded asset, valid `reason_tag`, tag consistent with action (e.g. `take_profit`/`cut_loss` only on SELL, `buy_dip` only on BUY after negative 24 h change) | `250 × valid / max(1, executed)` |

- Rounding: `floor` per factor.
- `provisional = trades < N OR completed_seasons < 1` (shown with a "new" badge), with **N = 8 during sprint seasons (until S5), 20 from S5**, read from the active trust rules version (`trust-v1-sprint` → `trust-v1`). Both versions are published via `publishRules`.
- Trades executed through Approve Big Move count as executed trades and as "follows its rules" (F1) — the owner signed off.
- Every bot starts with the same capital, so factors are comparable.
- Rules change only by publishing `trust-v2`; old seasons keep their version.

---

## 8. Leaderboards

Computed at each season close (and refreshed after every slot for "live" view). Season return uses the bot's value at season open, or at creation if it joined mid-week (labelled "joined Wed").

1. **Top Returns:** `R = V_end / V_start − 1`. Tiebreak: lower maxDD.
2. **Best Risk-Adjusted (Sortino, simple):** daily returns `r_d` from 21:00 marks; `downside = sqrt(mean(min(r_d,0)^2))`, floor 0.001; `S = mean(r_d) / downside`. Eligible: ≥ 3 executed trades and ≥ 3 daily returns in the season. Tiebreak: higher R.
3. **Most Trusted:** trust score total. Eligible: not provisional (§7: **≥ 8 trades during sprint seasons, ≥ 20 from S5**, plus ≥ 1 completed season). Tiebreak: earlier `createdAt`.
4. **Coach vs Bot (v1.1):** Daily Call win rate this season (min 2 calls during sprint seasons, 4 weekly). Shows the human's score, not the bot's.
- **Season battle:** your bot vs 3 house bots ranked by season R (plus any accepted challenges, §2.5). House bots (deterministic, no LLM, created by admin):
  - *Steady Sam* — equal 20 % in all 5 assets, rebalanced at the first 09:00 slot of each season.
  - *Gold Granny* — 50 % Gold, 50 % cash (the `createHouseBot` per-coin maximum; was 60/40, changed Nov 26 on #219), rebalanced at the first 09:00 slot of each season.
  - *Momentum Max* — each slot: hold assets with 24 h change > +2 % (up to 25 % each), sell those < −2 %.
- House bots appear on leaderboards with a "house" badge; excluded from rank #1 display ("Top human-raised bot").
- No prizes; recognition only (Bot of the Week post).

---

## 9. Share card generator

- `next/og` (`ImageResponse`, Satori) at `/api/card/[cardId]` → 1200×630 PNG (X/OG) and `?format=story` 1080×1920 (WhatsApp status).
- Card kinds: **trade** (first trade), **roast** (loss ≥ 3 % in a slot or worst call of the season), **battle** (season rank vs house bots), **season** (return, trust score, best & worst call), and v1.1: **recap** (daily, 21:35), **evolution** (v2 diff: "You said 'too risky' 3× → 40 % → 25 %", with config hash), **challenge** (bot vs bot result + Rematch), **call** (Daily Call result: "You 4 – AlphaWolf 3").
- Content: bot emoji + name, owner `name.qie` if any, ₹ value and % change, one line (roast or reason, from the logged decision — never newly invented), trust score, "Season n", QR/short link to `/bot/[botId]`, footer "Settled against QIE's official mainnet oracle · play money · not advice", short tx hash.
- **Verify on QIE (v1.1):** every card landing page (`/card/[cardId]`) has a "Verify on QIE" button that opens a panel listing each tx the card cites, with explorer links, the oracle roundId and a one-line "what this proves" (e.g. "This trade was priced by QIE's oracle round 50887, not by us").
- Data only from indexed on-chain records + logged decision text. Card payload stored in `cards` with the tx hashes it cites.
- Share: Web Share API (mobile) → WhatsApp/X; fallback copy-link + download.
- Cache: immutable per cardId (CDN 1 year).

---

## 10. Backend + stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router, TypeScript) on Vercel; Tailwind; PWA manifest. Reads from Supabase; calls the Render service for relays |
| Wallet | Privy React SDK, passkey login, embedded EOA, chain defined with viem `defineChain` (id 1990, rpc1–5, explorer). Fallback: thirdweb in-app wallet |
| Chain lib | viem (fallback transport over rpc1–rpc5) |
| Contracts | Foundry, OZ 5.0.2, solc 0.8.24, `evm_version = "shanghai"` |
| Worker + relayer | **One Render Web Service on a paid Starter instance** (Node 20/TS, always-on): runner, scheduler (UTC crons, §6.1), indexer, season close, trust/replay engine, and the relayer endpoint `POST /relay`. A Render Background Worker can't receive inbound HTTP, so the relayer would need a second service; a single paid web service does both. Keep keys server-side only |
| DB / storage | Supabase Postgres + Storage (replay files, public bucket) |
| LLM | Grok via xAI API (default), provider-agnostic `LlmClient` (§6.6); swap to OpenAI/Anthropic by env |
| Monitoring | Render health check on `/healthz`, Render logs, low-balance + LLM-budget alerts to Telegram/email, Supabase logs |
| QIE extras (v1.1) | QIE Wallet connect (EIP-1193) next to passkey — connect live, signed requests **COMING** until #189 (§0.6); QIE Wallet MCP client in the Render service for `.qie` reverse lookups (cached 24 h in `qie_names`; MCP live Nov 20 2026); QIE Pass partner API client (HMAC) behind a feature flag `PASS_ENABLED` (Pass still UNVERIFIED) |
| Public read layer (v1.1) | `GET /api/v1/bots/:id/record` on Vercel (JSON: bot, versions + config hashes, trades with tx hashes + roundIds, season results, trust score + Merkle proof) and a read-only **BotFolio MCP server** (§10.1) |

### 10.1 BotFolio MCP server (v1.1)
- Small read-only MCP server (Streamable HTTP) hosted on the Render service at `/mcp`. Tools:
  - `get_bot_record(bot_id)` — same payload as the public API.
  - `get_leaderboard(board, season?)` — top 20 for a board.
  - `verify_trade(tx_hash)` — re-reads the `Trade` event and the oracle round from QIE RPC, returns `{valid, price, roundId, matchesOracle}`.
- Demo moment: in Claude Desktop, "Is AlphaWolf actually good?" → the agent calls `get_bot_record` + `verify_trade` and answers from chain data. Shows "other agents can trust this record" in 10 seconds.
- No writes, no keys, rate-limited (60 req/min/IP).

**Render notes** ([pricing](https://render.com/pricing), [free tier](https://render.com/docs/free), [cost article](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses), checked Nov 19 2026):
- Free web services spin down after 15 min without traffic and take about a minute to wake, and may restart any time → **not usable** for the runner or relayer (missed slots, slow first relay).
- Background workers and private services have no free tier; paid Starter compute (0.5 CPU, 512 MB) is **$7/month**, prorated per second, runs continuously.
- Cron Jobs bill $0.00016/min on the smallest instance with a **$1/month minimum** per cron service.
- Don't use Render free Postgres (expires 30 days after creation); data stays on Supabase.
- Expected Render bill: ~$7/month (+ $1 if the safety-net cron is added). Region: Singapore (closest to India; confirm available in the dashboard).
- Why the relayer sits in the Render service, not Vercel: one place for hot keys, a warm process (no cold-start on the < 30 s path), shared rate-limit state, and a single nonce manager for the relayer wallet.

**Env vars**
```text
# chain
QIE_CHAIN_ID=1990
# local mainnet-fork staging: QIE_RPC_URLS=http://127.0.0.1:8545 (docs/anvil-fork.md). Chain id stays 1990.
QIE_RPC_URLS=https://rpc1mainnet.qie.digital,https://rpc2mainnet.qie.digital,https://rpc3mainnet.qie.digital,https://rpc4mainnet.qie.digital,https://rpc5mainnet.qie.digital
QIE_EXPLORER_URL=https://mainnet.qie.digital
FEED_BTC=0x9E596d809a20A272c788726f592c0d1629755440
FEED_ETH=0x4bb7012Fbc79fE4Ae9B664228977b442b385500d
FEED_SOL=0xe86999c8e6C8eeF71bebd35286bCa674E0AD7b21
FEED_XRP=0x804582B1f8Fea73919e7c737115009f668f97528
FEED_GOLD=0x9aD0199a67588ee293187d26bA1BE61cb07A214c
MAX_AGE_CRYPTO_S=1800
MAX_AGE_GOLD_S=21600
# contracts (after deploy)
FORWARDER_ADDRESS= BOT_REGISTRY_ADDRESS= PAPER_LEDGER_ADDRESS= SEASON_LEDGER_ADDRESS= TRUST_REGISTRY_ADDRESS=
# keys (server only, never NEXT_PUBLIC)
RELAYER_PRIVATE_KEY= RUNNER_PRIVATE_KEY= COMMITTER_PRIVATE_KEY=
DEPLOYER_PRIVATE_KEY=   # local only, for forge script; not on any server
# browser-visible (safe to expose: addresses and public URLs only)
NEXT_PUBLIC_QIE_CHAIN_ID=1990
NEXT_PUBLIC_FORWARDER_ADDRESS=
NEXT_PUBLIC_BOT_REGISTRY_ADDRESS=
NEXT_PUBLIC_PAPER_LEDGER_ADDRESS=
NEXT_PUBLIC_SEASON_LEDGER_ADDRESS=
NEXT_PUBLIC_DAILY_CALL_ADDRESS=
NEXT_PUBLIC_CHALLENGES_ADDRESS=
NEXT_PUBLIC_RELAY_URL=
NEXT_PUBLIC_SUPABASE_URL=
# wallet
NEXT_PUBLIC_PRIVY_APP_ID=
PRIVY_APP_SECRET=
# server-only HMAC secret for the 15-min relay JWT; placeholder, never a real secret
RELAY_JWT_SECRET=replace-me
# EIP-4361 domain for the SIWE-style signed login (placeholder)
SIWE_DOMAIN=localhost
# data
SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= NEXT_PUBLIC_SUPABASE_ANON_KEY= DATABASE_URL=
# llm
LLM_PROVIDER=xai            # xai | openai | anthropic
XAI_API_KEY=
XAI_BASE_URL=https://api.x.ai/v1
LLM_MODEL_DECISION=grok-4.20-0309-non-reasoning
LLM_MODEL_PERSONA=grok-4.20-0309-non-reasoning
LLM_MODEL_V2=grok-4.20-0309-non-reasoning   # optionally grok-4.7
LLM_TEMPERATURE=0
LLM_TIMEOUT_MS=20000
LLM_MONTHLY_BUDGET_USD=     # open decision
OPENAI_API_KEY= ANTHROPIC_API_KEY=   # only if swapping provider
PROMPT_VERSION=prompt-v1 TRUST_RULES_VERSION=trust-v1
# hosting
RENDER_SERVICE_URL=          # public URL of the Render service (frontend calls /relay here)
CRON_TZ=UTC
INTERNAL_CRON_SECRET=        # protects POST /internal/slot
# v1.1 contracts + QIE extras
DAILY_CALL_ADDRESS= CHALLENGES_ADDRESS=
QIE_WALLET_MCP_URL=https://mcp.qie.digital/mcp   # live, free, read-only (checked Nov 20 2026, §0.6)
PASS_ENABLED=false QIE_PASS_API_URL= QIE_PASS_API_KEY= QIE_PASS_HMAC_SECRET=
BIG_MOVE_BUY_WEIGHT_BPS=3000 BIG_MOVE_SELL_BPS=5000 BIG_MOVE_TTL_MIN=120
PROVISIONAL_MIN_TRADES_SPRINT=8 PROVISIONAL_MIN_TRADES_WEEKLY=20
# limits
RELAY_MAX_PER_USER_PER_DAY=30 RELAY_MAX_GLOBAL_PER_HOUR=2000 NEW_BOTS_PER_IP_PER_DAY=3
LOW_BALANCE_ALERT_QIE=2 ALERT_WEBHOOK_URL=
# display
USDINR_SOURCE_URL=   # approximate display rate only
APP_URL=
```

---

## 11. Security and abuse

- **Relayer allowlist (v1.1):** only `forwarder.execute` where `(request.to, selector)` ∈ {`BotRegistry.createBot`, `BotRegistry.setActive`, `SeasonLedger.commitVersion`, `SeasonLedger.recordCorrection`, `PaperLedger.executeApproved`, `DailyCall.call`, `Challenges.create`, `Challenges.accept`}; `value == 0`; `gas ≤ 300k` (tune after gas report; `executeApproved` reads several feeds, so measure it); deadline ≤ 10 min; verify with `forwarder.verify()` (staticcall) before sending. Also `eth_call` the inner request first and refuse to relay anything that would revert (saves gas on stale-price reverts).
- **Rate limits:** per wallet 30 relays/day, 1 bot per wallet, 3 new bots per IP/day, 20 corrections/day per bot (also on-chain), global 2,000 relays/hour. **Relay auth (v1.1 fix):** `POST /relay` on the Render service requires **either** a Privy session token (verified server-side) **or**, for QIE Wallet users who have no Privy session, a short-lived JWT from a SIWE-style login: `GET /auth/nonce` → the wallet signs an EIP-4361 message (domain `SIWE_DOMAIN`) → `POST /auth/verify` returns a 15-min JWT signed with `RELAY_JWT_SECRET` and bound to that address. Rate limits apply per wallet on both paths.
- **Hot wallets:** relayer, runner, committer are separate keys with small floats; admin role on a separate key not on servers; low-balance alerts; pause switch (`RELAY_ENABLED=false`).
- **Contracts:** no real funds, no `payable`, no token transfers; feeds immutable; runner cannot set prices; batch never reverts on one bad order.
- **LLM safety:** prompt injection via persona text can only affect that bot's play trades (gate caps everything); content filter on persona/reason/roast; persona length cap; no URLs in persona.
- **Sybil/metrics honesty:** report unique `_msgSender` signers and weekly active coaches; never present relayer/runner tx counts as user activity.
- **User-signed tx metric (v1.1):** the public `/stats` page splits on-chain activity into **user-signed** (createBot, corrections, v2 approvals, approved big moves, daily calls, challenges — counted by `_msgSender`) and **system** (runner batches, settlements, season roots). Lead with user-signed numbers in the deck; show system numbers separately. Optional "verified human" count from QIE Pass when enabled.
- **Legal / India gaming law:** no entry fees, no stakes, no prizes or rewards, no token, no cash-out, no real-asset purchase links. Copy on every page footer: "Play money. Not investment advice. No prizes." Recognition-only season shoutouts. Users must be 18+ (stated in the Terms of use and at sign-up as a one-line confirmation, decided Nov 20). That confirmation is stored as `users.terms_accepted_at timestamptz not null` (§3). The team also meets the hackathon 18+ rule.
- **Privacy:** store wallet address and Privy DID only; no phone/email unless the user opts into Privy email login.

---

## 12. Team build plan (IST, v1.1)

Four workstreams run in parallel using Claude Code (§16). Until Sunday Nov 22 night Gokul builds all code workstreams; Divesh and Dijo join after. The plan only works if **interfaces freeze on Day 1** (contract ABIs + events, DB schema, relay request format, card payload) so nobody waits on anyone.

### 12.1 Workstreams

| WS | Owner | Scope | Main sections |
|---|---|---|---|
| **A — Chain** | Gokul (GitHub: Gokul-social) — until Sun Nov 22 | 7 contracts, Foundry tests on mainnet fork, deploy + verify, ABI package, gas report. Local fork staging: [`docs/anvil-fork.md`](docs/anvil-fork.md) | §4, §5, §0.1–0.3 |
| **B — Runner** | Gokul (GitHub: Gokul-social) — until Sun Nov 22 | Render service: relayer + allowlist, LLM client, decision runner, gate + big-move split, scheduler, indexer, season close, DailyCall settle, trust/leaderboards, replay script, BotFolio MCP server | §6, §7, §8, §10, §10.1, §11 |
| **C — App** | Gokul (GitHub: Gokul-social) — until Sun Nov 22 | Next.js PWA: all screens S1–S11, Privy passkey + QIE Wallet connect, `.qie` display, ₹ display rule, price-age labels, `/proof`, `/stats` | §2, §3 (reads), §5.7 |
| **D — Growth & ecosystem** | Divesh (GitHub: DiveshK007) for registration, wallets, QIE checks, launch; Gokul for code | Share cards + Verify-on-QIE panel, public API, QIE Wallet MCP + Pass checks (§0.6), domain, launch content, soft launch + public launch, demo video, deck, README/docs | §0.6, §9, §13, traction |

### 12.2 Interfaces frozen on Day 1 (Fri Nov 20, by 23:00)
- `packages/contracts/abi/*.json` + `events.md` — every function signature and event in §4 (WS A publishes; B, C, D consume).
- `packages/db/schema.sql` — §3 tables incl. v1.1 additions (WS B publishes).
- `packages/shared/relay.ts` — the `ForwardRequest` type, EIP-712 domain/types for the forwarder and for `ApprovedOrder`, and the `POST /relay` request/response shape (WS B publishes, C consumes).
- `packages/shared/cards.ts` — card payload types for all 8 card kinds (WS D publishes).
- Changing a frozen interface after Day 1 = message the team first; update the file in one PR.

### 12.3 Timeline

| Day | A — Chain | B — Runner | C — App | D — Growth & ecosystem | Gate (must be true to move on) |
|---|---|---|---|---|---|
| **Fri Nov 20** | Repo scaffold (monorepo §16.1); interfaces; contracts written | DB schema; Render + xAI + Supabase accounts; `LlmClient` | Next.js scaffold; **passkey spike on 2 phones (iOS Safari + Android Chrome) → EIP-712 sig on 1990** | Register team on hackathon.qie.digital + QIE wallet address; fund deployer/relayer/runner wallets; apply for QIE Pass partner creds; check QIE Wallet + Wallet MCP (§0.6) | Interfaces frozen; passkey sig on 1990 works on both phones (else switch to thirdweb) |
| **Sat Nov 21** | Fork tests green (stale, limits, cap, batch-skip, forwarder `_msgSender`, `executeApproved` sig + replay guard, DailyCall, Challenges); gas report | Relayer + allowlist + rate limits against the local fork ([`docs/anvil-fork.md`](docs/anvil-fork.md)); persona + decision calls with strict schema; gate incl. big-move split | S1 landing + S2 create (mocked relay); ₹ display; price-age component | Card renderer for trade/roast/recap with mock data; domain bought | All tests green with `evm_version=shanghai`; gas per call known |
| **Sun Nov 22** | **Mainnet deploy + verify all 7**; addresses into env; seed 3 house bots | Indexer → Postgres; 4-slot scheduler; debut trade; executeBatch on mainnet | Real passkey → createBot → first trade on mainnet; S3 `/me`; S4 public bot page | `.qie` reverse lookup working or fallback; Verify-on-QIE panel | **End-to-end on mainnet: landing → first trade ≤ 30 s on a phone** |
| **Mon Nov 23** | Support B/C; admin scripts (open/close season, publish rules) | Corrections, big-move flow + expiry fallback, DailyCall settle, season open/close checks | Correct-a-call, Approve Big Move sheet, Daily Call sheet (S11) | Public API `/api/v1/bots/:id/record`; `/stats` user-signed vs system split | A real big move approved by a user executes on mainnet with the user as signer |
| **Tue Nov 24** | Replay script checks on-chain events | v2 proposal + Approve → `commitVersion`; season data root; trust score + `commitScores`; leaderboards (4 boards). **S0 test season opens** | S5 season close + v2 diff; S6 leaderboards; S10 challenge page; QIE Wallet connect | Battle/season/evolution/challenge/call cards; WhatsApp + X unfurl tests | All flows work in S0 |
| **Wed Nov 25** | Security pass on contracts (roles, keys, allowlist) | BotFolio MCP server (§10.1); load test 200 relays; alerts | Polish at 360 px; error/empty states; `/proof`, `/about` | **S0 closes 21:30 — check results, cards, v2 diffs.** Soft launch to 20 people at ~22:00 so they're in for S1 | S0 closed cleanly; ≥ 15/20 soft-launch users finish in < 30 s |
| **Thu Nov 26** | Fix list | Fix list; replay S0 exactly | Fix top 5 soft-launch frictions | **S1 opens.** First public posts (WhatsApp groups, coding club) | Replay reproduces S0 balances + root |
| **Fri Nov 27** | — | Watch S1 close 21:30 | Polish | **S1 closes.** Public launch: X thread from real roast + evolution cards; challenge links in groups | S1 results + cards live |
| **Sat Nov 28** | README contract docs | Monitoring; QIE float top-up | Final UI pass | Record the demo video (real S1 data); deck draft | Video final |
| **Sun Nov 29** | — | — | — | **S2 closes 21:30.** Traction screenshots from `/stats`; README, architecture diagram, trust-rules doc, replay guide; deck final | Repo public; fresh-clone README works |
| **Mon Nov 30** | All | All | All | **Submit by evening IST** (form + video + docs + deck). Night = buffer before 04:29 IST Dec 1 | Submission confirmed |
| **Dec 1–5** | On call | Keep runner healthy | — | Demo week: present with live S3/S4 results and the MCP demo | — |

### 12.4 Traction seeding (for the 90-day milestones; demo week Dec 1–5, winners Dec 10, then 90 days)
- First 100 users: CIT hostel/class WhatsApp groups ("Sharma ji's son" line), 5-minute coding-club demo, X thread of real roast cards, **challenge links** ("my bot vs yours, this season").
- Daily ritual: 21:35 recap card + Daily Call result. Season ritual: results post + Bot of the Week shoutout (recognition only).
- Track and screenshot weekly from `/stats` — **user-signed numbers first**:
  - wallet growth = unique wallets that signed `createBot`;
  - transaction volume = user-signed txs (corrections, approvals, big moves, daily calls, challenges); system txs shown separately;
  - recurring users = wallets with ≥ 1 user-signed tx in 2+ seasons;
  - active monthly usage = wallets with ≥ 1 user-signed tx in the last 30 days.
  These map to 4 of the 6 official milestone categories; merchants and revenue don't apply.

## 13. Submission checklist + demo video

**Official requirements** (sources §0.5)
- [ ] Deployed on **QIE mainnet** (testnet-only is ineligible); judges check contracts, transactions, deployment and frontend connectivity
- [ ] **Open-source smart contracts**, verified on `mainnet.qie.digital`
- [ ] **Live public app** (demo URL)
- [ ] **Public GitHub repository**, original work, clean commit history during the hackathon period (no forks/recycled code)
- [ ] **Demo video**
- [ ] **Documentation** (README, architecture, trust rules, replay guide, oracle caveat)
- [ ] **Team presentation** (short deck)
- [ ] Submission form: GitHub repo, live demo URL, deployed contract address(es), track
- [ ] Team: 18+, valid QIE wallet address, one submission per team
- [ ] Be ready to explain architecture to judges (AI-assisted dev allowed only if you understand your code)
- [ ] (v1.1) Every team member can explain their own workstream and answer: "walk me through the forwarder", "what happens when gold's price is stale?", "how does Approve Big Move stop double execution?", "why blockchain?" (§1.1)
- [ ] (v1.1) QIE components listed in README + deck with where each is used: Oracles, QIE Wallet, QIE ID / `.qie`, QIE Wallet MCP, QIE Pass (if live)
- [ ] (v1.1) `/stats` screenshots with user-signed vs system txs, and at least S1 + S2 closed with results

**Tracks:** DeFi & Financial Infrastructure · AI + Autonomous Agents · Consumer Apps & Social · Commerce & Real World · Developer Infrastructure & Tooling. Prizes: $5k / $3k / $2k overall, $500 per category, special awards Most Traction $2,500, Community Choice $1,000, Best Student Team $1,000. 50 % paid Dec 10, 50 % after *"any 3 traction milestones within 90 days"*.

**Judging (FAQ):** Innovation 30 · Technical Quality 25 · UX 15 · Mainnet Integration 15 · Business Potential 15; bonus for multiple QIE components (v1.1: Oracles, QIE Wallet connect, QIE ID / `.qie` names, QIE Wallet MCP — all core; QIE Pass badge if partner access arrives in time).

**Demo video beats (v1.1: 30 s cut for social, 2-min cut for judges)**

30 s cut:
| Time | Shot |
|---|---|
| 0–3 s | Phone: type "Careful like my dad, loves gold" → tap Make my bot |
| 3–6 s | Face ID → bot card "Gold Guru" with 2 sliders → Launch |
| 6–10 s | First trade card: "Bought ₹25,000 of Gold · QIE oracle round 14811" → tap → explorer tx |
| 10–14 s | "Gold Guru wants 35 % in Gold. Allow?" → Face ID → trade executes, signed by the user |
| 14–17 s | Roast notification on a loss → tap "Bad call: too risky" |
| 17–23 s | **Hero moment:** season close, v2 diff "You said 'too risky' 3× → max per coin 40 % → 25 %" → Approve → config hash on QIE |
| 23–27 s | Roast / evolution card on WhatsApp → friend taps Verify on QIE |
| 27–30 s | "Raise an AI trader in one sentence. Coach it. Let QIE keep score." |

2-min judge cut adds: the "why blockchain" three answers (§1.1); `/proof` with 7 verified contracts and the oracle caveat; Claude Desktop asking the BotFolio MCP "Is AlphaWolf actually good?" and verifying a trade from chain data; `/stats` with user-signed numbers; challenge link flow.

---

## 14. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Passkey wallet doesn't work on chain 1990 or on some phones | Day-1 spike on 2 phones; fallback thirdweb in-app wallet; last resort Privy email/Google login (still no seed phrase) |
| 2 | Oracle stale or operator stops (gold sometimes > 6 h; crypto sometimes > 30 min) | Skip-and-hold per asset, retries, price age label + "holding" UI; batch never reverts; caveat wording; never claim trustless |
| 3 | Toolchain mismatch: QIE lacks Cancun opcodes | Pin OZ 5.0.2 + `evm_version=shanghai`; fork tests on mainnet; no 7702/4337 SDK modes |
| 4 | Relayer gas drain / abuse / RPC flakiness | Allowlist, per-user and global caps, small hot floats, alerts, 5-RPC failover |
| 5 | LLM flakiness/cost and the "AI-generated project" rule | xAI strict structured outputs + deterministic gate; budget cap with hold fallback; provider swappable by env; original architecture documented; Divesh can explain every contract |
| 6 | Looks like gambling or financial advice | Play money, no prizes/tokens/fees, not-advice copy, no real-asset buy links |
| 7 | **Name clash:** botsfolio.com (AI paper-trading bots) is a near-identical name | Differentiate everywhere by personality bots raised in one sentence, season-by-season coaching with on-chain version history, and provable QIE records; always write "BotFolio" with capital F and the tagline |
| 8 | (v1.1) QIE Pass partner access stays unconfirmed, or QIE Wallet `signTypedData` fails on chain 1990 | Pass stays behind `PASS_ENABLED` and off the core loop. The signed QIE Wallet path stays COMING until #189. `.qie` names and Wallet MCP were live on Nov 20 2026, with the fallbacks in §0.6 if they drop |
| 9 | (v1.1) Users ignore Approve Big Move prompts | Expiry fallback executes a clipped order after 2 h (§6.4 step 10), so the bot never stalls; prompt is also a push/feed item |
| 10 | (v1.1) Double execution of a big move (user approves + runner fallback) | `usedOrder[orderId]` (per action, §3) in `PaperLedger` for both paths; fork test covers a 3-action decision with one big move |
| 11 | (v1.1) Interface churn between 4 parallel workstreams | Interfaces frozen Day 1 (§12.2); changes only via one announced PR |
| 12 | (v1.1) Judges read the repo as "AI-generated with minimal developer contribution" | Small commits per person with real messages; each owner writes their own README section and can explain it live (§16.4) |

---

## 15. Open decisions (need Divesh)

Resolved Nov 19: track = AI + Autonomous Agents; gold max age = 6 h with price-age label; LLM = Grok via xAI (swappable); host = Render, relayer in the same Render service.

Resolved Nov 20: workstream owners, copied from `CLAUDE.md` — A, B and C: Gokul (GitHub: Gokul-social) until Sun Nov 22; D: Divesh (GitHub: DiveshK007) for registration, wallets, QIE checks, launch; Gokul for code. Until Sunday Nov 22 night Gokul builds all code workstreams; Divesh and Dijo join after (README). See §12.1.

1. **LLM monthly budget cap** (`LLM_MONTHLY_BUDGET_USD`); about $28/mo per 100 active bots at the default model (estimate, §6.6).
2. **Domain** purchase (botfolio.* availability to confirm at a registrar).
3. **Demo-week presenter** (Dec 1–5) and who records the demo video.
4. (v1.1) **Big-move thresholds** (default 30 % buy weight / 50 % sell) — fine for launch, revisit after S1.

---

## 16. Building with Claude Code (v1.1)

### 16.1 Repo layout (monorepo, pnpm workspaces)
```text
botfolio/
  CLAUDE.md                 # rules every Claude Code session reads first (mirrors §16.2)
  SPEC.md                   # this file — the source of truth
  packages/
    contracts/              # WS A — Foundry: src/, test/ (mainnet fork), script/, abi/, events.md. Local staging: docs/anvil-fork.md
    shared/                 # frozen interfaces: relay.ts, eip712.ts, cards.ts, chain.ts (defineChain 1990), assets.ts
    db/                     # WS B — schema.sql, migrations/
    llm/                    # WS B — LlmClient + XaiClient/OpenAiClient/AnthropicClient
  apps/
    web/                    # WS C (+ WS D cards/api) — Next.js 15 on Vercel
    worker/                 # WS B — Render service: relay, runner, scheduler, indexer, seasons, mcp
  scripts/
    replay/                 # npx botfolio-replay
  docs/                     # architecture.md, trust-rules.md, replay.md, oracle-caveat.md, anvil-fork.md
```

### 16.2 Rules for every Claude Code session
1. **Read `SPEC.md` sections for your workstream before writing code.** The spec wins over Claude's defaults. If the spec is ambiguous, ask the owner, don't guess.
2. **Never edit another workstream's folder** without asking its owner. Frozen interfaces (`packages/shared`, `abi/`, `schema.sql`) change only through one announced PR.
3. **Chain rules are hard rules:** solc 0.8.24, `evm_version = "shanghai"`, `@openzeppelin/contracts@5.0.2` pinned exactly, no `mcopy`/`tstore`, no EIP-7702 / ERC-4337 modes, chain ID 1990, all 5 RPCs with failover.
4. **No secrets in code or in `NEXT_PUBLIC_*`.** Keys only in Render/Vercel env. Never paste private keys into a Claude Code session.
5. **Small commits, real messages, one logical change each**, made by the person who owns the work. No giant "initial commit" dumps. Commit at least every hour of active work.
6. **Tests before "done":** contracts → `forge test` on a mainnet fork; worker → unit tests for `gate()`, big-move split, season close, trust score; web → the 30 s path checked on a real phone. Local mainnet-fork staging (Anvil, deploy, app RPC): [`docs/anvil-fork.md`](docs/anvil-fork.md).
7. **Honest wording everywhere:** "settled against QIE's official mainnet oracle", never "trustless" or "decentralised". Play money, not advice, no prizes.
8. **Mark anything unverified** in code comments and docs as `UNVERIFIED` — same rule as this spec.
9. **You must be able to explain every line you commit.** If Claude wrote something you don't understand, ask it to explain, or simplify it, before committing.

### 16.3 Starting prompts per workstream (paste into Claude Code on Day 1)

**WS A — Chain**
> Read CLAUDE.md, then SPEC.md §0.1–0.3, §4 and §5. Scaffold `packages/contracts` with Foundry (solc 0.8.24, evm_version shanghai, OZ 5.0.2 pinned). Write the 7 contracts in §4.9 exactly as specified, with OZ AccessControl roles from §4.6. Then write fork tests against `https://rpc3mainnet.qie.digital` (fall back to rpc4/rpc5) using the real feed addresses from §0.2: stale feed skip, limits, max-per-coin cap, batch never reverts, forwarder `_msgSender`, `executeApproved` runner signature + deadline + per-order `usedOrder` replay guard, DailyCall call/settle with the runner-signed bot view, Challenges create/accept/settle. Export ABIs to `abi/` and list every event in `events.md`. Don't deploy yet. Stop and show me the interface (function signatures + events) before writing implementations.

**WS B — Runner**
> Read CLAUDE.md, then SPEC.md §3, §6, §7, §8, §10, §10.1, §11. Start with `packages/db/schema.sql` (all §3 tables incl. v1.1) and `packages/shared/relay.ts` (ForwardRequest type, EIP-712 domains for the forwarder and ApprovedOrder, POST /relay shape). Then build `packages/llm` (LlmClient interface + XaiClient with strict json_schema output) and `apps/worker`: relay endpoint with the §11 allowlist and rate limits, then the pure `gate()` function with unit tests (including the big-move split, §6.4 steps 9–10). Use ABIs from `packages/contracts/abi` once WS A publishes them; until then, stub them. Show me schema.sql and relay.ts first — they get frozen tonight.

**WS C — App**
> Read CLAUDE.md, then SPEC.md §1, §2, §5 (display rules), §0.4 and §10. Scaffold `apps/web` (Next.js 15 App Router, TypeScript, Tailwind, PWA manifest). First task is the passkey spike: Privy passkey sign-up + embedded wallet + `signTypedData` on a custom viem chain (id 1990, 5 RPCs) — a single test page I can open on an iPhone and an Android phone. Then build S1 and S2 against a mocked `/relay`. Mobile-first, 360 px minimum. ₹ display rule from §3 and the price-age label from §5.7 as shared components.

**WS D — Growth & ecosystem**
> Read CLAUDE.md, then SPEC.md §0.6, §1.1, §9, §13 and §12.4. First, check each item in §0.6 against the live sources (QIE Wallet integration guide, QIE Wallet MCP at mcp.qie.digital/mcp, QIE Pass integration docs) and write what actually works into `docs/qie-components.md`. Then define `packages/shared/cards.ts` (payload types for all 8 card kinds) and build the card renderer in `apps/web/app/api/card/[cardId]` with `next/og`, using mock data, 1200×630 and 1080×1920 story format. Then the Verify-on-QIE panel and the public record API.

### 16.4 Making the repo look (and be) human-built
- Each owner writes the README section for their workstream in their own words.
- `docs/decisions.md`: one line per real decision with date and who made it (e.g. "Nov 21 — pinned OZ 5.0.2 because 5.6.1 uses mcopy — A").
- Keep commit authorship per person; no squashing everything into one commit at the end.
- Before demo week, each owner does a 10-minute "explain it to the team" walkthrough of their part.
