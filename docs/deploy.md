# First production deploy (#25, #26, #27, #28, #188, #130–#132)

One pass, top to bottom. Steps marked **YOU** need your accounts, keys or a phone; everything else is a command in this repo. Never paste a key, `DATABASE_URL` or any other secret into a chat or an issue: type them into your terminal or the dashboards only. Variable meanings: [`env.md`](env.md). After launch: [`release.md`](release.md), [`runbook.md`](runbook.md), [`rollback.md`](rollback.md).

Tools on your machine: Foundry (`forge`, `cast`), `pnpm` 9, `jq`, `psql`, `xxd`, `git`, Node 20.

## 1. Code on `main` (YOU: merge)

Merge, in this order, once CI is green: #316 (contract guards — the deploy needs this bytecode), then the other open PRs. Pull `main` and check `forge test` is green on it.

## 2. Keys (YOU, ~10 min)

Five different wallets; the deploy script refuses repeats. Make each one as a Foundry keystore, so the key is stored encrypted and forge asks for a password:

```sh
cast wallet new                                       # run 5 times, or use existing wallets
cast wallet import botfolio-deployer --interactive    # paste the key, set a password
cast wallet import botfolio-admin --interactive       # the cold key: admin of every contract
```

Runner, committer and relayer keys go only into Render (step 7); you need just their **addresses** now. Back all five up in a password manager (#157). Fund on QIE mainnet (#97) — gas is ~1.1 gwei, the whole 7-contract deploy is ~12.6 M gas ≈ 0.015 QIE:

| Wallet | Fund |
|---|---|
| deployer | 1 QIE |
| admin | 1 QIE |
| relayer | 5 QIE |
| runner | 5 QIE |
| committer | 2 QIE |

## 3. Deploy and verify the contracts (~5 min)

```sh
cd packages/contracts
export ADMIN_ADDRESS=0x… RUNNER_ADDRESS=0x… COMMITTER_ADDRESS=0x… RELAYER_ADDRESS=0x…
script/dry-run.sh                                     # simulates on a fork, sends nothing
DEPLOYER_ACCOUNT=botfolio-deployer script/deploy-mainnet.sh   # YOU: type 'deploy', then the keystore password
script/verify-mainnet.sh                              # source on mainnet.qie.digital (#26), no key needed
DEPLOYER_ADDRESS=0x… script/check-mainnet.sh          # roles + wiring read back from the chain (#27)
```

`deploy-mainnet.sh` writes `deployments/1990.env` (public addresses + start block). Commit it together with `broadcast/Deploy.s.sol/1990/run-latest.json`. If anything fails after the broadcast, `script/deploy-mainnet.sh --from-broadcast` rewrites the env file without deploying again.

## 4. Database (YOU: create the Supabase project, ~5 min)

1. supabase.com → New project (region: Mumbai or Singapore). Storage → New bucket `replay`, **public**.
2. In your terminal (the URL holds the DB password; it never leaves your machine):

```sh
export DATABASE_URL='postgres://…'      # Project Settings → Database → session pooler string
scripts/db/setup.sh                     # schema + season rows; refuses a database that already has them
ADMIN_ADDRESS=0x… pnpm --filter ./apps/worker house:seed db   # names for the 3 house bots
```

Any migration merged after this (e.g. `0003_…`): `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/migrations/<file>.sql`.

## 5. Trust rules and house bots (YOU: keystore password)

`docs/trust-rules.md` on `main` must be final: it is hashed and published permanently.

```sh
ADMIN_ACCOUNT=botfolio-admin packages/contracts/script/launch-admin.sh
```

It publishes `trust-v1-sprint` and `trust-v1` (doc pinned to the current `main` commit) and creates Steady Sam, Gold Granny and Momentum Max as botIds 1–3. Reruns skip what is done. Commit `broadcast/Admin.s.sol/1990/` and put the tx hashes in `docs/decisions.md` (#188). **S0 is opened by the worker itself** at its first start (step 7), with the committer key.

## 6. Privy (YOU, ~5 min)

dashboard.privy.io → create app "BotFolio" → Login methods: **Passkey** on (email as fallback), Embedded wallets: create on login (EVM). Settings → Allowed origins: your Vercel URL(s) and `http://localhost:3000`. Copy the App ID and the App secret.

## 7. Worker on Render (YOU: dashboard)

render.com → New → **Blueprint** → this repo (`render.yaml`, Starter plan, Singapore). Fill every `sync: false` value from [`env.md`](env.md) (addresses from `deployments/1990.env`; the three hot keys; Supabase; xAI; Privy; webhook). Leave `RELAY_ENABLED=false`. Deploy, then:

```sh
curl -s https://<service>.onrender.com/healthz | jq '.status, .reasons, .jobs'
```

Expect `ok` or `degraded` only for stale feeds. In the logs: `seasons.opened` for S0 (tx on the explorer).

## 8. Web on Vercel (YOU: `vercel login` once; then the CLI or dashboard)

Vercel → Add project → this repo, **Root Directory `apps/web`** (pnpm monorepo is detected). Env from [`env.md`](env.md) "Web": `NEXT_PUBLIC_RELAY_URL` = the Render URL, the 7 `NEXT_PUBLIC_*_ADDRESS`, `NEXT_PUBLIC_PRIVY_APP_ID`, `APP_URL`. Deploy. Then on Render set `WEB_ORIGINS` and `APP_URL` to the Vercel URL, `SIWE_DOMAIN` to its host, and finally **`RELAY_ENABLED=true`** → redeploy. Add the Vercel URL to Privy's allowed origins.

## 9. Smoke test (YOU: a real phone, #76 / #146)

On iPhone Safari and Android Chrome, stopwatch running: open the site → type a sentence → Launch → passkey → bot page shows the debut trade with an explorer link (target ≤ 30 s). Check the tx on https://mainnet.qie.digital: `from` = relayer, the `ExecutedForwardRequest` signer = your wallet. Then: `/healthz` ok, `/proof` lists the 7 verified contracts, `/stats` shows 1 user-signed tx.

## 10. Paperwork

README submission table (addresses, live URL, video), `docs/decisions.md` lines for the deploy and S0, then the hackathon form (#121): repo, live URL, contract addresses, track **AI + Autonomous Agents**.
