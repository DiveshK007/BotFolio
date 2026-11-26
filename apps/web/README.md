# apps/web — WS C (App) · WS D owns `app/api/card` and `app/api/v1`
Next.js 15 (App Router, TS, Tailwind v4) on Vercel. Package name: `@botfolio/web`.
Screens: SPEC §2.4 (S1–S11). Website pages: `docs/briefs/WEBSITE_BRIEF.md`. Min width 360 px.

## Run it
```sh
pnpm install                              # from the repo root
pnpm --filter @botfolio/web dev           # http://localhost:3000
pnpm --filter @botfolio/web typecheck     # next typegen + tsc
pnpm --filter @botfolio/web lint
pnpm --filter @botfolio/web build
```
Env: copy the `NEXT_PUBLIC_*` lines from the root `.env.example` into `apps/web/.env.local`. Nothing secret goes in `NEXT_PUBLIC_*`.

## Sign-in and bot creation (#71, #75, #76, #86)
Web env (Vercel, all public, no secrets):

| Var | What |
|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy app id. Empty = no passkey button. The worker needs the same value plus `PRIVY_APP_SECRET` (Render only) |
| `NEXT_PUBLIC_RELAY_URL` | Render service origin (this is the "worker URL"; there is no separate `NEXT_PUBLIC_WORKER_URL`) |
| `NEXT_PUBLIC_FORWARDER_ADDRESS`, `NEXT_PUBLIC_BOT_REGISTRY_ADDRESS` | Deployed contracts. Missing = "Bot creation isn't live yet" |
| `NEXT_PUBLIC_QIE_RPC_URLS` | Optional, comma-separated, tried in order. Empty = rpc3, rpc4, rpc5, rpc1, rpc2 |

- **Passkey (Privy):** `components/PrivyWallet.tsx`, loaded lazily from the root layout only when the app id is set. Passkey login where the device has WebAuthn, email otherwise; an embedded EOA is made on login; QIE mainnet (1990) is the only chain. No smart wallets.
- **Connect QIE Wallet:** any injected EIP-1193 wallet (`window.ethereum`). Switches/adds chain 1990, then SIWE against the worker (`GET /auth/nonce` → `personal_sign` → `POST /auth/verify` → 15-min JWT, kept in `sessionStorage` only). The worker's `SIWE_DOMAIN` must equal the site's host (`localhost:3000` locally), so it doesn't work on Vercel preview URLs. QIE Wallet's `signTypedData` on 1990 is **UNVERIFIED** (#189).
- Screens use `getWallet()` / `getQieWallet()` to sign in and `useSession()` (`lib/wallet.ts`) to read who is signed in; never the SDK.
- Privy dashboard: add the site origin (and `http://localhost:3000`) to allowed origins, turn on passkey login (and passkey sign-up) and email, turn on Ethereum embedded wallets, leave smart wallets off.
- `@solana/kit` is in `dependencies` only so pnpm resolves Privy's optional Solana peers to one compatible version; without it `next build` fails inside Privy's (unused) Solana code.

## Notes
- `@botfolio/shared` exports raw `.ts`, so `next.config.ts` lists it in `transpilePackages`.
- Design tokens (`styles/tokens.css`) are copied from the Claude Design export (#184) so app screens and site pages look like one product. They are exposed to Tailwind in `app/globals.css` (`bg-paper`, `text-ink`, `text-up`, …). Dark mode = `data-theme="dark"` on `<html>`.
- `next-env.d.ts` is generated (`next typegen`) and not committed.
- PWA manifest: `app/manifest.ts` → `/manifest.webmanifest`.
