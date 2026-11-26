# Environment variables (#135)

Every variable the worker (Render) and the web app (Vercel) read, where it goes, and whether it is a secret. Names only: **never write a value here, in an issue, a PR or a chat.** `.env.example` has the same names for local work. Order of setting them up: [`deploy.md`](deploy.md).

Secret = must only ever be in the Render or Vercel dashboard (or your local `.env`, never committed). Never put a secret in a `NEXT_PUBLIC_*` name: Next ships those to every browser.

## Worker (Render, `render.yaml`)

| Name | Secret | Value / where it comes from |
|---|---|---|
| `QIE_CHAIN_ID` | no | `1990` (in `render.yaml`) |
| `QIE_RPC_URLS` | no | the 5 mainnet RPCs, rpc3 first (in `render.yaml`) |
| `MAX_AGE_CRYPTO_S` / `MAX_AGE_GOLD_S` | no | `1800` / `21600` (in `render.yaml`) |
| `FORWARDER_ADDRESS`, `BOT_REGISTRY_ADDRESS`, `PAPER_LEDGER_ADDRESS`, `SEASON_LEDGER_ADDRESS`, `TRUST_REGISTRY_ADDRESS`, `DAILY_CALL_ADDRESS`, `CHALLENGES_ADDRESS` | no | `packages/contracts/deployments/1990.env` after the deploy |
| `INDEXER_START_BLOCK` | no | same file: the deploy's first block |
| `RELAYER_PRIVATE_KEY` | **yes** | relayer hot wallet (pays gas for users' signed requests) |
| `RUNNER_PRIVATE_KEY` | **yes** | runner hot wallet (`executeBatch`, signs bot views and big-move orders) |
| `COMMITTER_PRIVATE_KEY` | **yes** | committer hot wallet (seasons, scores, Daily Call settle, challenges) |
| `RELAY_ENABLED` | no | `false` until everything else is set, then `true` (deploy.md step 8) |
| `RELAY_JWT_SECRET` | **yes** | 32+ characters; `render.yaml` generates one |
| `WEB_ORIGINS` | no | exact web origin(s), comma-separated, e.g. `https://botfolio.vercel.app` (no wildcard) |
| `APP_URL` | no | the web app's public URL (fallback for `WEB_ORIGINS`, links in alerts) |
| `SIWE_DOMAIN` | no | the web app's host only, e.g. `botfolio.vercel.app` (Connect QIE Wallet login) |
| `TRUSTED_PROXY_HOPS` | no | `1` on Render. **UNVERIFIED**: check one real request's `x-forwarded-for` after the first deploy |
| `NEXT_PUBLIC_PRIVY_APP_ID` | no | Privy dashboard → App ID (public by design) |
| `PRIVY_APP_SECRET` | **yes** | Privy dashboard → App secret |
| `DATABASE_URL` | **yes** | Supabase → Project Settings → Database → connection string (session pooler, port 5432) |
| `SUPABASE_URL` | no | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | Supabase → Project Settings → API → `service_role` key |
| `REPLAY_BUCKET` | no | `replay` (a **public** Supabase Storage bucket; deploy.md step 4) |
| `LLM_PROVIDER` | no | `anthropic` (Claude Haiku 5.5, Nov 26 decision). `xai` + `XAI_API_KEY` still works |
| `LLM_MODEL_DECISION` | no | `claude-haiku-5-5` (persona and v2 use the same model unless `LLM_MODEL_PERSONA` / `LLM_MODEL_V2` are set) |
| `ANTHROPIC_API_KEY` | **yes** | platform.claude.com → API keys |
| `LLM_MONTHLY_BUDGET_USD` | no | `4`: past it the bots rest and hold instead of spending more (the account holds $5) |
| `ALERT_WEBHOOK_URL` | **yes** | a Slack or Discord incoming webhook (anyone with it can post) |
| `LOW_BALANCE_ALERT_QIE` | no | `2` |
| `PORT` | no | set by Render |

Optional, with safe defaults in code: `LLM_MODEL_DECISION`, `LLM_MODEL_PERSONA`, `LLM_MODEL_V2`, `LLM_TEMPERATURE`, `LLM_TIMEOUT_MS`, `PROMPT_VERSION`, `ORACLE_REFRESH_MS`, `BIG_MOVE_*`, `RELAY_MAX_PER_USER_PER_DAY`, `RELAY_MAX_GLOBAL_PER_HOUR`, `NEW_BOTS_PER_IP_PER_DAY`, `USDINR_SOURCE_URL`, and the kill switches `PERSONA_DISABLED`, `BIG_MOVES_DISABLED`, `DAILY_CALL_DISABLED`, `BOT_PAGE_DISABLED`, `LEADERBOARDS_DISABLED`, `STATS_DISABLED`, `TRUST_DISABLED` (`runbook.md`).

## Web (Vercel, project root `apps/web`)

All of these are public (they end up in the browser bundle), so only addresses and URLs.

| Name | Value |
|---|---|
| `NEXT_PUBLIC_RELAY_URL` | the Render service URL, e.g. `https://botfolio-worker.onrender.com` |
| `NEXT_PUBLIC_FORWARDER_ADDRESS` … `NEXT_PUBLIC_CHALLENGES_ADDRESS` | the 7 addresses from `deployments/1990.env` (the deploy script prints them with the prefix) |
| `NEXT_PUBLIC_PRIVY_APP_ID` | same App ID as the worker |
| `NEXT_PUBLIC_QIE_RPC_URLS` | optional; the browser's RPC list (defaults to the 5 mainnet RPCs) |
| `NEXT_PUBLIC_QIE_EXPLORER_URL` | optional; `https://mainnet.qie.digital` |
| `APP_URL` | the production URL (server-side: card and share links) |
| `SITE_DATA_MODE` | optional (website v3): `live` once contracts and the worker are up |
| `QIE_RPC_URLS` | optional, server-side reads (e.g. Verify any tx) |

## Local only (never on a server)

| Name | Use |
|---|---|
| `ADMIN_ADDRESS`, `RUNNER_ADDRESS`, `COMMITTER_ADDRESS`, `RELAYER_ADDRESS` | inputs to `script/deploy-mainnet.sh` (public addresses) |
| `DEPLOYER_ACCOUNT`, `ADMIN_ACCOUNT` | names of Foundry keystores (`cast wallet import … --interactive`); the keys stay encrypted on your machine |
| `START_CASH_E8` | leave unset: the script's default `107800000000` is the decided value (#219) |
