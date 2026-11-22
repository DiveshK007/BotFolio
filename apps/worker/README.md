# apps/worker — WS B (Runner)
Render web service (Node 20, TS): `/relay`, decision runner, scheduler, indexer, season open/close, DailyCall settle, BotFolio MCP at `/mcp`, `/healthz`. SPEC §6, §10, §10.1, §11.

## Run locally
```bash
pnpm install
cp .env.example apps/worker/.env   # fill in locally; never commit it
pnpm --filter @botfolio/worker dev      # tsx watch
pnpm --filter @botfolio/worker test     # vitest, no network except localhost
pnpm --filter @botfolio/worker build && PORT=10000 node apps/worker/dist/index.js
curl localhost:10000/healthz
```
`LLM_PROVIDER=fake` runs without any LLM key.

## Render
- Service type: Web Service, paid Starter (always-on — free tier sleeps, SPEC §10). Region Singapore.
- Build: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @botfolio/worker build`
- Start: `node apps/worker/dist/index.js` · Health check path: `/healthz`
- Env: everything in `.env.example` that the worker uses, set in the Render dashboard only.

## /healthz
Always HTTP 200 while the process is up (a stale gold price must not make Render restart us). The body says what's degraded:
`{ status: "ok"|"degraded", reasons[], lastSlotRun, oracle: { checkedAt, feeds[{asset, roundId, priceE8, ageSeconds, fresh, …}] }, llm: { provider, month, spentUsd, capUsd, budget } }`. The web's degraded banner (#171) reads `status` and `reasons`.

## RPC
viem `fallback` over `QIE_RPC_URLS` in the order rpc3 → rpc4 → rpc5 → rpc1 → rpc2 (rpc1/rpc2 drop TLS sometimes). A local Anvil fork URL stays first.
