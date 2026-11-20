Read CLAUDE.md and SPEC.md first. Then read website-export/SITE_SPEC.md and website-export/BUILD_BRIEF.md.

Task: build the BotFolio website into apps/web (WS C; /api/card and /api/v1 stay with WS D). The export in website-export/apps/web is the starting point: copy it in following BUILD_BRIEF's build order, merge app/layout.tsx with any existing root layout, and keep class names and tokens as they are so site and app screens look like one product. Use website-export/prototype/index.html and screens/ as the visual reference.

Rules:
- Every claim must trace to SPEC.md. Keep the footer "Play money. Not investment advice. No prizes." on every page. Say "settled against QIE's official mainnet oracle"; never "trustless" or "decentralised"; no invest/earn/profit/stake/rewards/prizes CTAs.
- Every data block shows LIVE, EXAMPLE or NOT LIVE YET. EXAMPLE hashes never link out. No made-up fallback numbers; on fetch failure keep the section and show the explorer link.
- QIE Wallet connect, .qie names, QIE Wallet MCP and QIE Pass stay "COMING" unless docs/qie-components.md confirms them.
- Agree the Supabase view names in lib/site/data.ts with the WS B owner before wiring; don't edit packages/shared or schema.sql yourself.
- One issue per task, branch `c/<issue#>-website`, small commits with real messages. Explain anything non-obvious in the PR.

When done: run typecheck, build and tests, screenshot every site route at 1440 and 360 in light and dark, show me the diff, and don't push or deploy until I say so.
