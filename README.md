# BotFolio

**Raise an AI trader in one sentence, coach it every season, and let QIE keep score.**

Describe a trading personality in one sentence and an AI bot is born. It paper-trades BTC, ETH, SOL, XRP and Gold with play money, four times a day. Every trade is priced by QIE's official mainnet oracle and recorded on QIE mainnet. You coach it, approve its big moves, and each season approve a new version of its brain — committed on-chain, so anyone can check how it learned.

Built for **QIE Hackathon 3.0 (Mainnet Edition)** · AI + Autonomous Agents track.

> Play money. Not investment advice. No prizes.

## Status
🚧 In active development (Nov 20 – Nov 30 2026). Mainnet contract addresses, live app URL and demo video will be listed here once live.

## Docs
- [`SPEC.md`](SPEC.md) — full product and technical spec (source of truth)
- [`CLAUDE.md`](CLAUDE.md) — rules for contributors and Claude Code sessions
- [`docs/decisions.md`](docs/decisions.md) — decision log
- [`docs/anvil-fork.md`](docs/anvil-fork.md) — local mainnet-fork staging (Anvil)
- [`docs/briefs/`](docs/briefs) — website and video briefs

## Repo layout
```text
packages/contracts   Solidity (Foundry) — WS A
packages/shared      Shared types/constants: chain, assets, relay + card interfaces
packages/db          Postgres schema + migrations — WS B
packages/llm         LLM client interface + providers — WS B
apps/web             Next.js 15 app + site — WS C (cards + public API: WS D)
apps/worker          Render service: relayer, runner, scheduler, indexer, MCP — WS B
scripts/replay       Season replay / verification script — WS B
docs                 Architecture, trust rules, replay guide, decisions
```

## Working on it
Tasks live in [GitHub Issues](https://github.com/DiveshK007/BotFolio/issues), grouped by workstream label and day milestone. See `CLAUDE.md` → "How we work".

## Team
- **Divesh** (DiveshK007) — product, QIE ecosystem, launch and submission
- **Gokul** (Gokul-social) — builds all workstreams through Sun Nov 22
- **Dijo** — joins after Nov 22
