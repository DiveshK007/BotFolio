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

## Notes
- `@botfolio/shared` exports raw `.ts`, so `next.config.ts` lists it in `transpilePackages`.
- Design tokens (`styles/tokens.css`) are copied from the Claude Design export (#184) so app screens and site pages look like one product. They are exposed to Tailwind in `app/globals.css` (`bg-paper`, `text-ink`, `text-up`, …). Dark mode = `data-theme="dark"` on `<html>`.
- `next-env.d.ts` is generated (`next typegen`) and not committed.
- PWA manifest: `app/manifest.ts` → `/manifest.webmanifest`.
