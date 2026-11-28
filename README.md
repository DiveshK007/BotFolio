<a id="readme-top"></a>

<div align="center">

# BotFolio

**Raise an AI trader in one sentence, coach it every season, and let QIE keep score.**

[![web](https://img.shields.io/github/actions/workflow/status/DiveshK007/BotFolio/web.yml?branch=main&style=for-the-badge&label=web)](https://github.com/DiveshK007/BotFolio/actions/workflows/web.yml)
[![worker](https://img.shields.io/github/actions/workflow/status/DiveshK007/BotFolio/worker.yml?branch=main&style=for-the-badge&label=worker)](https://github.com/DiveshK007/BotFolio/actions/workflows/worker.yml)
[![contracts](https://img.shields.io/github/actions/workflow/status/DiveshK007/BotFolio/contracts.yml?branch=main&style=for-the-badge&label=contracts)](https://github.com/DiveshK007/BotFolio/actions/workflows/contracts.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-333333?style=for-the-badge&logo=typescript&logoColor=white)
![Solidity](https://img.shields.io/badge/Solidity-333333?style=for-the-badge&logo=solidity&logoColor=white)

[Quick start](#quick-start) · [How it works](#how-it-works) · [Documentation](#documentation) · [Contributing](#contributing)

</div>

<br/>

> [!IMPORTANT]
> **Hackathon build (Nov 20 – Nov 30 2026). Live app: https://bot-folio.vercel.app**
>
> Status on Nov 27 2026, 02:30 IST:
> - All 7 contracts have been live and source-verified on QIE mainnet (chain 1990) since Nov 26. Addresses are in [Contracts](#contracts), and the deploy record is [`packages/contracts/deployments/1990.env`](packages/contracts/deployments/1990.env).
> - Season 0, the hidden test season, opened on-chain Nov 27 00:24 IST and closes Nov 28 21:30. Season 1, the first public one, runs Nov 29 00:00 → Nov 30 21:30 IST.
> - Proven on mainnet: passkey sign-up on Android, and a user-created bot (#4) where the user signed and our relayer paid the gas.
> - UNVERIFIED until seen: the first trade (debut or slot), the Daily Call settle, a season close with its trust-score commit, challenges, and the replay of a closed season. First-run checks: [docs/runbook.md](docs/runbook.md) §9.
> - Demo video: the [3-minute walkthrough](https://bot-folio.vercel.app/judges#demo), hosted on the site, and the [1-minute trailer on X](https://x.com/diveshbuilds/status/2126515736873247034). Both are also in [Submission links](#submission-links).
>
> **Play money. Not investment advice. No prizes.**

## Overview

BotFolio is a paper-trading game for people who are curious about AI and trading but don't want to risk money or write code. You describe a trading personality in one sentence and an AI bot is born. It trades BTC, ETH, SOL, XRP and Gold with play money four times a day, and every trade is settled against QIE's official mainnet oracle and recorded on QIE mainnet. You coach it, approve its big moves, and each season approve a new version of its brain, committed on-chain so anyone can check how it learned.

Built for **QIE Hackathon 3.0 (Mainnet Edition)**, AI + Autonomous Agents track.

### Features

- **One sentence to a bot.** The LLM turns "Careful like my dad, loves gold" into a name, rules and two sliders: max per coin (10–50 %) and max trades per day (1–8).
- **Trades priced inside the contract.** `PaperLedger` reads the QIE oracle feed itself at execution time and stores the round id with each trade. The price is never passed in.
- **Coaching you can see.** Tap "Bad call" on a decision. At season close the bot proposes v2 from your corrections ("You said 'too risky' 3× → max per coin 40 % → 25 %"), and you sign the new config hash.
- **You stay in charge of big moves.** A buy that would put 30 % or more into one asset, or a sell of 50 % or more of a holding, waits for your Allow / Shrink / Block.
- **No gas, no seed phrase.** Every user action is an EIP-712 request that our relayer sends through `BotForwarder`. Users never pay gas.
- **Anyone can recompute a season.** `pnpm replay` re-runs the risk gate on the logged LLM output, re-reads the oracle rounds and checks the season root on-chain.

## Why BotFolio

AI paper trading already exists (Strategy Arena, pip.world, Botsfolio, Alpha Arena). In those you enter a coded bot or watch famous AIs trade. Results usually travel as screenshots, and a screenshot is easy to fake.

```text
"My bot made 40 % this week"  ← a screenshot: no trade, no price, no history behind it
```

BotFolio handles this differently: anyone can raise a bot in one sentence and coach it, and every version of its brain and every trade is recorded on QIE mainnet with the oracle round it was priced against.

Why a blockchain and not just a database:

1. **Anyone can check, not just us.** Every share card has a *Verify on QIE* link. The trade tx, the oracle round and the version hash are on QIE mainnet.
2. **Other apps and agents can read the record.** A read-only BotFolio MCP server lets any AI agent fetch a bot's track record and re-check a trade against the oracle.
3. **The record outlives the app.** The bot, its trades and its versions belong to the owner's address. If BotFolio shut down, the history stays on QIE and the replay script still recomputes it.

> **You coach your bot, and every version of its brain is committed on-chain, so its record shows how it learned from you.**

## Requirements

| Requirement | Details |
| :--- | :--- |
| **OS** | Linux or macOS (anything that runs Node 20 and Foundry) |
| **Runtime** | Node.js ≥ 20 (`.nvmrc` says 20), pnpm 9.12.0 (`packageManager` in `package.json`) |
| **Optional** | [Foundry](https://getfoundry.sh) (`forge`, `anvil`, `cast`) for the contracts and the local mainnet fork; `jq` for `script/export-abi.sh` |

## Installation

There is no package to install. Run it from source:

```bash
git clone --recurse-submodules https://github.com/DiveshK007/BotFolio.git
cd BotFolio
corepack enable      # pnpm 9.12.0 on Node 20–24; on newer Node: npm i -g pnpm@9.12.0
pnpm install
pnpm build
```

The submodules are OpenZeppelin (pinned at v5.0.2) and forge-std, used by `packages/contracts`.

### Updating

```bash
git pull
git submodule update --init --recursive
pnpm install
```

> [!WARNING]
> Never commit a filled-in `.env`, and never put a secret in a `NEXT_PUBLIC_*` variable: everything with that prefix is sent to the browser. Real keys live only in the Vercel and Render dashboards.

## Quick start

Run the worker without any LLM key, then the web app against it:

```bash
cp .env.example apps/worker/.env                       # fill in locally; never commit it
set -a; . apps/worker/.env; set +a                     # the worker reads the environment, not the file
LLM_PROVIDER=fake pnpm --filter @botfolio/worker dev   # worker in watch mode, no LLM key needed
curl localhost:10000/healthz                           # in another shell: "ok" or "degraded" plus the reasons
pnpm --filter @botfolio/web dev                        # app on http://localhost:3000
```

The worker listens on `PORT` (default 10000). With an empty `.env` it starts and reports itself `degraded`: each part it can't run yet (relayer, scheduler, indexer) is listed in the startup log with the variables it is missing. For the web app, copy the `NEXT_PUBLIC_*` lines from `.env.example` into `apps/web/.env.local` and point `NEXT_PUBLIC_RELAY_URL` at the worker. To try changes without touching mainnet, run against a local mainnet fork: [docs/anvil-fork.md](docs/anvil-fork.md).

## Usage

### Commands

All from the repo root unless the row says otherwise.

| Command | Description |
| :--- | :--- |
| `pnpm build` | Build every package that has a `build` script. |
| `pnpm typecheck` | Type-check every package. |
| `pnpm test` | Unit tests (vitest) in every package. |
| `pnpm lint` | Lint (the web app has a `lint` script). |
| `pnpm replay <file or URL>` | Recompute a season from its replay file. `--offline` skips the chain checks, `--rpc <url,url>` picks other RPCs. |
| `pnpm --filter @botfolio/web dev` | Next.js dev server on port 3000. |
| `pnpm --filter @botfolio/worker dev` | Worker (relayer, runner, scheduler, indexer, MCP) in watch mode. |
| `forge test --fork-url qie -vv` | In `packages/contracts`: contract tests on a QIE mainnet fork. |
| `script/dry-run.sh` | In `packages/contracts`: simulate the mainnet deploy with throwaway addresses. Never broadcasts. |

### Examples

**Check a closed season yourself**

```bash
pnpm --filter @botfolio/replay build
pnpm replay 0 --ledger <SeasonLedger address>   # fetches the replay file the chain points to
```

The exit code is 0 when every decision, trade, oracle round, balance and the season root match.

**Run the contract tests on a mainnet fork**

```bash
cd packages/contracts
forge build
forge test --fork-url qie -vv   # "qie" is rpc3, set in foundry.toml
```

## Configuration

Settings come from environment variables. [`.env.example`](.env.example) lists every one; copy it to `apps/worker/.env` for the worker and the `NEXT_PUBLIC_*` lines to `apps/web/.env.local` for the app. The full reference with comments is SPEC §10.

```bash
QIE_CHAIN_ID=1990          # QIE mainnet; also used on the local fork
QIE_RPC_URLS=...           # comma-separated rpc1–rpc5 with failover (default: all five mainnet RPCs)
LLM_PROVIDER=anthropic     # xai | openai | anthropic | fake. Production: anthropic (Claude Haiku 5.5). Unset: xai
```

### Environment variables

The ones you most often need. Never paste values into an issue, PR or chat.

| Variable | Effect |
| :--- | :--- |
| `QIE_RPC_URLS` | QIE RPCs, tried in order. The worker starts at rpc3 because rpc1 and rpc2 sometimes drop TLS. Set `http://127.0.0.1:8545` for the local fork. |
| `FEED_BTC` … `FEED_GOLD` | The 5 QIE oracle feed addresses. |
| `FORWARDER_ADDRESS`, `BOT_REGISTRY_ADDRESS`, `PAPER_LEDGER_ADDRESS`, `SEASON_LEDGER_ADDRESS`, `TRUST_REGISTRY_ADDRESS`, `DAILY_CALL_ADDRESS`, `CHALLENGES_ADDRESS` | Contract addresses. The mainnet ones are in [`deployments/1990.env`](packages/contracts/deployments/1990.env). |
| `RELAYER_PRIVATE_KEY`, `RUNNER_PRIVATE_KEY`, `COMMITTER_PRIVATE_KEY` | Three separate hot wallets, server only. |
| `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Postgres and Storage (replay files). Server only. |
| `LLM_PROVIDER`, `ANTHROPIC_API_KEY` (or `XAI_API_KEY`, `OPENAI_API_KEY`), `LLM_MODEL_DECISION` | LLM provider, key and model (production: `anthropic`, `claude-haiku-5-5`). `fake` runs without a key. |
| `RELAY_ENABLED` | The relayer only sends when this is exactly `true`; anything else, or unset, keeps it off. Not in `.env.example`. |
| `NEXT_PUBLIC_RELAY_URL` | Where the browser finds the worker (`/relay` and the read routes). |
| `NEXT_PUBLIC_*_ADDRESS` | Contract addresses for the browser. Addresses and public URLs only. |

## Privacy and safety

- **Play money only.** No real money, token, NFT, entry fee, stake, prize, cash-out or real-asset buy link. Every bot starts with the same $100,000 of play capital. Long or cash only, no shorting, no leverage.
- **Users never pay gas.** Users sign EIP-712 requests. Our relayer pays gas and relays only an allowlist of 8 contract functions, with `value == 0`, a gas cap and a deadline of at most 10 minutes. It checks each request with `forwarder.verify()` and an `eth_call` before sending.
- **What we store:** wallet address, Privy ID (passkey logins only) and login method; sign-up time, the 18+ / Terms confirmation and last-seen time; your last few AI-written bot personalities before you launch one; and a log of each action we relay for you. Details are on the app's `/privacy` page ([source](apps/web/app/privacy/page.tsx)).
- **No phone or email** unless you choose Privy email login.
- **Honest wording.** Trades are settled against QIE's official mainnet oracle. One QIE-operated wallet pushes all feed updates, and the app says so on `/proof`.
- **Honest metrics.** Users are counted by `_msgSender`. Relayer and runner transactions are never presented as user activity.

## How it works

```mermaid
flowchart LR
    U["User on the web app<br/>(Next.js, Vercel)"] -- "signs EIP-712<br/>ForwardRequest" --> R["Relayer<br/>POST /relay"]
    subgraph W["Worker (one Render service)"]
        R
        S["Scheduler<br/>4 slots a day"] --> L["LlmClient<br/>Claude Haiku 5.5"]
        L --> G["gate()<br/>deterministic risk rules"]
        I["Indexer<br/>10 s loop"]
        A["Read routes + MCP<br/>/bot-page, /leaderboards, /mcp"]
    end
    R --> F["BotForwarder<br/>(ERC-2771)"]
    F --> C["BotRegistry · SeasonLedger<br/>PaperLedger.executeApproved<br/>DailyCall · Challenges"]
    G -- "runner key" --> P["PaperLedger.executeBatch"]
    O[("QIE oracle feeds<br/>BTC ETH SOL XRP Gold")] -. "latestRoundData()<br/>read inside the contract" .-> P
    O -.-> C
    C -- events --> I
    P -- events --> I
    I --> D[("Supabase Postgres")]
    D --> A
    A --> U
```

A user's action (create a bot, correct a call, approve v2 or a big move, a Daily Call, a challenge) is an EIP-712 request signed in the browser and sent through our relayer to `BotForwarder`, so the contract sees the user as `_msgSender`. Four times a day (09:00, 13:00, 17:00, 21:00 IST) the runner asks the LLM for each bot's decision under a strict JSON schema. A pure function, `gate()`, then clips it to the bot's limits, drops stale assets and splits out big moves, and the runner sends the rest in one `PaperLedger.executeBatch`. The key design decision: **prices are read inside the contracts, never passed in**, and a stale feed (over 30 min for crypto, 6 h for gold) makes that asset hold without reverting the batch. The indexer copies contract events into Postgres; the web app, the read routes and the MCP server read from there. At each season close the worker uploads a replay file to Supabase Storage and commits its Merkle root to `SeasonLedger` and the trust-score root to `TrustScoreRegistry`.

### Contracts

Solidity 0.8.24, `evm_version = "shanghai"`, OpenZeppelin 5.0.2. Source in [packages/contracts/src](packages/contracts/src).

| Contract | What it does | Mainnet address |
| :--- | :--- | :--- |
| `BotForwarder` | OpenZeppelin `ERC2771Forwarder`: runs the user-signed requests the relayer sends | [`0x4540…B63b`](https://mainnet.qie.digital/address/0x4540D079EdD350388d1B3d40e7F71Db2E8DfB63b) (verified) |
| `BotRegistry` | `createBot`, `setActive`; bot owner and limits | [`0xcb0a…Bb22`](https://mainnet.qie.digital/address/0xcb0a69339d987Dcdd43F3d4f774f1d46a23dBb22) (verified) |
| `PaperLedger` | Play balances and the trade log. `executeBatch` (runner) and `executeApproved` (user-approved big move) read the oracle on-chain | [`0x6B63…7401`](https://mainnet.qie.digital/address/0x6B63231303bBE1C92c0BA6FE16731848f8077401) (verified) |
| `SeasonLedger` | Open and close seasons with the data root, `commitVersion`, `recordCorrection` | [`0x3288…f902`](https://mainnet.qie.digital/address/0x32883A866e73BABB980c457C6c6A256fb6D9f902) (verified) |
| `TrustScoreRegistry` | `publishRules`, `commitScores`, `verifyScore` (Merkle) | [`0xe914…5A0F`](https://mainnet.qie.digital/address/0xe91451560c0F1069D4C561863c2ae95cEF845A0F) (verified) |
| `DailyCall` | You vs your bot: BTC up or down by 21:00. Records the oracle price at call time | [`0x1C09…e77d`](https://mainnet.qie.digital/address/0x1C0963871a960fC5d2a2de5C11d5Cd75548ce77d) (verified) |
| `Challenges` | `create`, `accept`, `settle` at season close; max 10 open per bot | [`0x78c7…6d83`](https://mainnet.qie.digital/address/0x78c7337b8Ab2A8bA2A99647a90e8d9A5C0B76d83) (verified) |

### QIE components

| Component | Where it is used | Status |
| :--- | :--- | :--- |
| **QIE oracle feeds** (BTC, ETH, SOL, XRP, Gold) | Read inside `PaperLedger` and `DailyCall` (`src/lib/OracleReader.sol`); re-read by `verify_trade` and the replay script | Live in the deployed contracts (Nov 26); first mainnet trade UNVERIFIED (Nov 27) |
| **QIE mainnet** (chain 1990) | All 7 contracts; RPC failover over rpc1–rpc5 | Live, verified (Nov 26) |
| **QIE Wallet** | "Connect QIE Wallet" login next to passkey ([#86](https://github.com/DiveshK007/BotFolio/issues/86), PR #322); relay auth for it is in the worker (`/auth/nonce`, `/auth/verify`) | Connect live; EIP-712 signing on chain 1990 not tested yet as of Nov 27 ([#99](https://github.com/DiveshK007/BotFolio/issues/99)) |
| **QIE ID / `.qie` names** | `name.qie` instead of `0x…` on bot pages, leaderboards and cards ([#87](https://github.com/DiveshK007/BotFolio/issues/87), [#104](https://github.com/DiveshK007/BotFolio/issues/104)) | Live (PR #321); lookups checked on mainnet Nov 26 |
| **QIE Wallet MCP** | Server-side `.qie` reverse lookups (`qie_reverse_lookup`, cached 24 h) ([#104](https://github.com/DiveshK007/BotFolio/issues/104)) | Live (PR #321); `qie_reverse_lookup` checked Nov 26 with qie.qie |
| **QIE Pass** | Optional "verified human" badge behind `PASS_ENABLED` ([#110](https://github.com/DiveshK007/BotFolio/issues/110)) | Partner access not confirmed (UNVERIFIED, Nov 27) |

### Submission links

| Item | Link |
| :--- | :--- |
| Live app | https://bot-folio.vercel.app (live mode, checked Nov 27) |
| Demo video | [3-minute walkthrough](https://bot-folio.vercel.app/judges#demo) (hosted on the site, [#394](https://github.com/DiveshK007/BotFolio/issues/394)) · [1-minute trailer on X](https://x.com/diveshbuilds/status/2126515736873247034) |
| Contract addresses | [Contracts](#contracts) · [`deployments/1990.env`](packages/contracts/deployments/1990.env) |
| Explorer | [mainnet.qie.digital](https://mainnet.qie.digital) |

## Tech stack

| Component | Tool |
| :--- | :--- |
| **Web app** | [Next.js 15](https://nextjs.org) (App Router, TypeScript) + [Tailwind CSS](https://tailwindcss.com), hosted on [Vercel](https://vercel.com) |
| **Wallet** | [Privy](https://www.privy.io) passkey embedded wallet, live; sign-up checked on Android by Nov 27, iPhone Safari UNVERIFIED ([#71](https://github.com/DiveshK007/BotFolio/issues/71)). QIE Wallet connect as the second login |
| **Chain library** | [viem](https://viem.sh) with fallback transport over the 5 QIE RPCs |
| **Contracts** | [Foundry](https://getfoundry.sh), [OpenZeppelin Contracts 5.0.2](https://github.com/OpenZeppelin/openzeppelin-contracts), solc 0.8.24 |
| **Worker** | Node 20 / TypeScript web service on [Render](https://render.com): relayer, runner, scheduler, indexer, season close, MCP |
| **Database and storage** | [Supabase](https://supabase.com) Postgres + Storage (replay files) |
| **LLM** | Claude Haiku 5.5 (`claude-haiku-5-5`) through the Anthropic API since Nov 26, via `LlmClient` (swappable by env: `LLM_PROVIDER=xai` for Grok, or `openai`). Capped at $4 a month; at the cap bots hold |
| **Chain** | [QIE mainnet](https://mainnet.qie.digital), chain id 1990 |

## Project structure

```text
.
├── apps/
│   ├── web/            # Next.js app and site (WS C; cards + public API: WS D)
│   └── worker/         # Render service: relayer, runner, scheduler, indexer, MCP (WS B)
├── packages/
│   ├── contracts/      # Solidity (Foundry): the 7 contracts, tests, deploy and admin scripts (WS A)
│   ├── db/             # Postgres schema, migrations and seeds (WS B)
│   ├── llm/            # LlmClient interface + xAI / OpenAI / Anthropic / fake providers (WS B)
│   └── shared/         # Shared types and constants: chain, assets, relay, card payloads
├── scripts/
│   └── replay/         # botfolio-replay: recompute and verify a season (WS B)
├── docs/               # runbook, rollback, trust rules, gas report, decisions, briefs
├── website-export/     # Claude Design export of the website: prototype, page spec, screenshots
├── SPEC.md             # product and technical spec, the source of truth
└── CLAUDE.md           # rules for contributors and Claude Code sessions
```

## Development

Read [SPEC.md](SPEC.md) (the source of truth) and [CLAUDE.md](CLAUDE.md) before making changes. Each workspace has its own README with the details.

```bash
git clone --recurse-submodules https://github.com/DiveshK007/BotFolio.git
cd BotFolio
pnpm install         # install dependencies
pnpm test            # unit tests in every package
pnpm typecheck       # type checks
pnpm lint            # lint
```

Hard rules for the chain side: QIE has no Cancun, so no `mcopy`, `tstore` or `tload`, and OpenZeppelin stays pinned at 5.0.2 (5.6.x uses `mcopy`). No EIP-7702 or ERC-4337 wallet modes. Only the 5 oracle feeds, read inside the contracts.

## Troubleshooting

<details>
<summary><b>RPC calls to rpc1 or rpc2 fail with a TLS error</b></summary>

<br/>

rpc1 and rpc2 sometimes drop TLS handshakes. Put rpc3 first and keep the others as failover:

```bash
QIE_RPC_URLS=https://rpc3mainnet.qie.digital,https://rpc4mainnet.qie.digital,https://rpc5mainnet.qie.digital,https://rpc1mainnet.qie.digital,https://rpc2mainnet.qie.digital
```

</details>

<details>
<summary><b><code>forge build</code> can't find <code>@openzeppelin</code> or <code>forge-std</code></b></summary>

<br/>

The repo was cloned without its submodules. Fix it with:

```bash
git submodule update --init --recursive
```

</details>

<details>
<summary><b><code>/healthz</code> says <code>"degraded"</code> with <code>"scheduler not started: DATABASE_URL is not set"</code></b></summary>

<br/>

The worker is missing a setting. The runner needs `DATABASE_URL`, `BOT_REGISTRY_ADDRESS`, `PAPER_LEDGER_ADDRESS`, `DAILY_CALL_ADDRESS`, `RUNNER_PRIVATE_KEY` and the LLM provider's key; the startup log names every missing variable per part. Set them in `apps/worker/.env` (or the Render dashboard), load the file again and restart:

```bash
curl localhost:10000/healthz   # "reasons" lists what is still degraded
```

</details>

## Limitations

- **Oracle freshness.** QIE feeds sometimes go 45–144 min without a new crypto round, and gold has gone over 6 h. Those slots hold that asset instead of trading. Gold prices can be hours old, so the app always shows the price age.
- **One feed operator.** A single QIE-operated wallet pushes all feed updates. Trades are settled against QIE's official mainnet oracle; they are only as good as that feed.
- **LLM output is not reproducible.** Calls log the model id and use temperature 0 where the model accepts it (Claude Haiku 5.5 doesn't, so it runs at its default), but the same input can give a different answer. What we claim: given the logged LLM output, everything after it (gate, orders, balances, marks, trust scores) is deterministic and recomputable.
- **No Cancun on QIE.** Contracts target Shanghai: no `mcopy`, `tstore`/`tload`, no P-256 precompile, no EIP-7702 or ERC-4337 smart-account wallets.
- **Five assets, long or cash.** BTC, ETH, SOL, XRP and Gold only (QIE has no stock feeds). No shorting, no leverage.

## Roadmap

- [x] 7 contracts with mainnet-fork tests and a deploy dry run
- [x] Relayer with allowlist, rate limits, nonce manager and QIE Wallet relay auth
- [x] Risk gate, scheduler, big moves, v2 proposals, house bots logic, trust scores and season close
- [x] Replay script, leaderboards, BotFolio MCP server code
- [x] `/proof`, `/about`, `/terms`, `/privacy`, bot page and leaderboards pages
- [x] Deploy the 7 contracts to QIE mainnet and verify them ([#25](https://github.com/DiveshK007/BotFolio/issues/25), [#26](https://github.com/DiveshK007/BotFolio/issues/26))
- [x] Passkey sign-in with Privy on chain 1990 (PR #322); Android checked by Nov 27, iPhone Safari pending ([#71](https://github.com/DiveshK007/BotFolio/issues/71))
- [x] Worker live on Render, Season 0 opened on-chain (Nov 27 00:24 IST)
- [ ] Season 0 closed, replayed and its trust scores committed (Nov 28 21:30 IST)
- [ ] Newcomer path end to end on mainnet in under 30 s ([#76](https://github.com/DiveshK007/BotFolio/issues/76))
- [x] Public API `GET /api/v1/bots/:id/record` ([#106](https://github.com/DiveshK007/BotFolio/issues/106)) and `/stats` ([#92](https://github.com/DiveshK007/BotFolio/issues/92))
- [x] Connect QIE Wallet and `.qie` names, code ([#86](https://github.com/DiveshK007/BotFolio/issues/86), [#87](https://github.com/DiveshK007/BotFolio/issues/87))
- [x] Owner screens: /me, corrections, Approve Big Move, Daily Call, season v2 approve, challenges (PR #323)
- [x] Deploy kit: mainnet deploy/verify/role-check scripts, Render blueprint, runbook ([docs/deploy.md](docs/deploy.md), PR #320)
- [ ] Demo video, deck and submission ([#116](https://github.com/DiveshK007/BotFolio/issues/116), [#117](https://github.com/DiveshK007/BotFolio/issues/117), [#121](https://github.com/DiveshK007/BotFolio/issues/121))
- [ ] Weekly seasons from S5, Dec 7 ([#179](https://github.com/DiveshK007/BotFolio/issues/179))

## Documentation

| Guide | What's in it |
| :--- | :--- |
| [SPEC.md](SPEC.md) | Full product and technical spec: verified QIE facts, flows, contracts, runner, trust score, stack |
| [CLAUDE.md](CLAUDE.md) | Rules for contributors and Claude Code sessions, and how we work |
| [docs/architecture.md](docs/architecture.md) | Components, diagram and data flows: create a bot, a slot, a user-signed action, season close |
| [docs/oracle-caveat.md](docs/oracle-caveat.md) | The QIE oracle caveat: one operator, update gaps, max ages, skip and hold |
| [docs/replay.md](docs/replay.md) | Recompute a season, and what is and isn't reproducible |
| [docs/trust-rules.md](docs/trust-rules.md) | Trust score rules `trust-v1-sprint` and `trust-v1` |
| [docs/deploy.md](docs/deploy.md) | First production deploy, end to end: keys, contracts, database, rules and house bots, Render, Vercel, smoke test |
| [docs/env.md](docs/env.md) | Every environment variable: where it comes from, and whether it is a secret |
| [docs/runbook.md](docs/runbook.md) | Incidents (restart, stale oracle, LLM down, RPC down, wallet top-up, key rotation), first-run checks per path, Dec 1–7 on-call |
| [docs/release.md](docs/release.md) | Release checklist, code freeze, no-merge windows |
| [docs/judge-qa.md](docs/judge-qa.md) | The four judge questions with code pointers, and the known limits |
| [docs/launch-copy.md](docs/launch-copy.md) | Launch post drafts, coding-club run sheet, stopwatch sheet |
| [docs/master-plan.md](docs/master-plan.md) | The Nov 27 – Dec 7 plan: waves, human checklist, risks, decisions |
| [docs/rollback.md](docs/rollback.md) | Rollback: Vercel, Render, contract-address switch |
| [docs/gas.md](docs/gas.md) | Gas report from a mainnet fork, and the relayer gas cap |
| [docs/anvil-fork.md](docs/anvil-fork.md) | Local mainnet-fork staging with Anvil |
| [docs/decisions.md](docs/decisions.md) | Decision log |
| [docs/briefs/](docs/briefs) | Website and demo video briefs |
| [packages/contracts/README.md](packages/contracts/README.md) | Contract setup, asset index, deploy and admin scripts, ABIs |
| [packages/contracts/events.md](packages/contracts/events.md) | Every contract event (frozen interface) |
| [apps/worker/README.md](apps/worker/README.md) | Worker: run locally, Render setup, gate, big moves, season close, MCP |
| [apps/web/README.md](apps/web/README.md) | Web app: run it, env, design tokens |
| [packages/db/README.md](packages/db/README.md) | Database schema and migrations |
| [scripts/replay/README.md](scripts/replay/README.md) | What the replay script checks and how to run it |

## Contributing

Work happens in [GitHub Issues](https://github.com/DiveshK007/BotFolio/issues), each labelled with its workstream (`ws:A-chain`, `ws:B-runner`, `ws:C-app`, `ws:D-growth`) and a day milestone. One issue gets one branch named `<ws>/<issue#>-short-name` and one PR that follows the [pull request template](.github/pull_request_template.md). The full workflow is in [CLAUDE.md → How we work](CLAUDE.md#how-we-work). Don't edit another workstream's folder without asking its owner.

## Security

Please don't report security problems in public issues. Contact a maintainer (listed under [Team](#team)) privately instead.

## Team

- **Divesh** ([DiveshK007](https://github.com/DiveshK007)): product, QIE ecosystem, launch and submission
- **Gokul** ([Gokul-social](https://github.com/Gokul-social)): built all code workstreams through Sun Nov 22
- **Dijo** ([Dijo-404](https://github.com/Dijo-404)): joined after Nov 22

## License

[MIT](LICENSE). BotFolio uses play money only: no real money, tokens, NFTs or prizes.

## Acknowledgements

- [QIE](https://www.qie.digital) for the mainnet, the oracle feeds and [Hackathon 3.0](https://hackathon.qie.digital)
- [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) for `ERC2771Forwarder` and access control
- [Foundry](https://getfoundry.sh) for the contract toolchain and mainnet-fork tests

<br/>

<div align="center">
  <sub>Play money. Not investment advice. No prizes.</sub><br/>
  <sub>Built by <a href="https://github.com/DiveshK007/BotFolio">the BotFolio team</a> · <a href="#readme-top">Back to top</a></sub>
</div>
