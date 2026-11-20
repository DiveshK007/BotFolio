# BotFolio — rules for Claude Code

BotFolio: raise an AI trader in one sentence, coach it every season, and let QIE keep score. QIE Hackathon 3.0 (Mainnet Edition), AI + Autonomous Agents track. Submission: 23:59 CET Nov 30 2026 (04:29 IST Dec 1).
Repo: https://github.com/DiveshK007/BotFolio

**`SPEC.md` is the source of truth.** Read the sections for your workstream before writing code. If the spec is unclear, ask the owner — don't guess. If you think the spec is wrong, say so instead of quietly doing something different.

## Workstreams and owners
| WS | Folder(s) | Owner |
|---|---|---|
| A — Chain | `packages/contracts` | Gokul (GitHub: Gokul-social) — until Sun Nov 22 |
| B — Runner | `apps/worker`, `packages/db`, `packages/llm`, `scripts/replay` | Gokul (GitHub: Gokul-social) — until Sun Nov 22 |
| C — App | `apps/web` (except cards + public API) | Gokul (GitHub: Gokul-social) — until Sun Nov 22 |
| D — Growth & ecosystem | `apps/web/app/api/card`, `apps/web/app/api/v1`, `docs/` | Divesh (GitHub: DiveshK007) for registration, wallets, QIE checks, launch; Gokul for code |

Until Sunday Nov 22 night Gokul builds all code workstreams; Divesh and Dijo join after. Don't edit another workstream's folder without asking its owner. Frozen interfaces — `packages/shared/*`, `packages/contracts/abi/*`, `packages/db/schema.sql` — change only via one announced PR.

## Hard rules
- **Chain:** QIE mainnet, chain ID 1990. RPCs `https://rpc{1..5}mainnet.qie.digital` with failover (rpc1/rpc2 drop TLS sometimes). Explorer `https://mainnet.qie.digital`.
- **Solidity:** 0.8.24, `evm_version = "shanghai"`, `@openzeppelin/contracts@5.0.2` pinned exactly. QIE has no Cancun: no `mcopy`, `tstore`/`tload`. No EIP-7702 or ERC-4337 wallet modes. No P-256 precompile.
- **Oracles:** only the 5 feeds in SPEC §0.2 (BTC, ETH, SOL, XRP, Gold). Prices are read inside contracts, never passed in. Crypto max age 30 min, gold 6 h. Stale = skip and hold in batches, never revert the batch.
- **Gas:** users never pay. Every user action is an EIP-712 request through `BotForwarder`, sent by our relayer, which only relays the allowlisted calls in SPEC §11.
- **Secrets:** never in code, never in `NEXT_PUBLIC_*`, never pasted into a chat. Render/Vercel env only.
- **Wording:** "settled against QIE's official mainnet oracle" — never "trustless" or "decentralised". Every page: "Play money. Not investment advice. No prizes."
- **Legal:** no real money, tokens, NFTs, stakes, entry fees, prizes, cash-out or real-asset buy links. Ever.
- **Metrics:** never present relayer/runner txs as user activity. Count users by `_msgSender`.
- **Unverified:** mark anything you haven't checked against a live source as `UNVERIFIED` in comments and docs.

## How we work
- **Work from GitHub issues.** Every task is an issue labelled with its workstream (`ws:A-chain`, `ws:B-runner`, `ws:C-app`, `ws:D-growth`) and a day milestone. Assign yourself before starting. One issue → one branch named `<ws>/<issue#>-short-name` (e.g. `a/12-paperledger-execute-batch`) → one PR whose description says `Closes #12`. Don't start work that has no issue; open one first.
- `main` must always build. Merge via PR; the workstream owner reviews PRs that touch their folder.
- Small commits, one logical change each, real messages, committed by the person who owns the work. At least one commit per hour of active work.
- Tests before "done": `forge test` on a mainnet fork for contracts; unit tests for `gate()`, big-move split, season close and trust score; the 30 s newcomer path checked on a real phone for the app.
- Whoever commits code must be able to explain it to a judge. If you (Claude) write something non-obvious, explain it in the PR description or a short comment.
- Log real decisions in `docs/decisions.md`: date — decision — why — who.

## Stack
Next.js 15 (App Router, TS, Tailwind) on Vercel · Privy passkey embedded wallet (fallback thirdweb) + QIE Wallet connect · viem · Foundry · Render web service (Node 20/TS) for relayer + runner + scheduler + indexer + MCP · Supabase Postgres + Storage · Grok via xAI behind `LlmClient` (swappable by env).
