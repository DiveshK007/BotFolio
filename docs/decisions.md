# Decision log
Format: date — decision — why — who.

- Nov 19 — Product: BotFolio (AI paper-trading bots, play money), AI + Autonomous Agents track — best fit of ship speed, solo loop and QIE oracle use — team
- Nov 19 — Pin `@openzeppelin/contracts@5.0.2`, solc 0.8.24, `evm_version=shanghai` — QIE mainnet has no Cancun; OZ 5.6.1 uses `mcopy` — team
- Nov 19 — Gas sponsored via own ERC-2771 forwarder + relayer — QIE has no paymaster/bundler — team
- Nov 19 — LLM: Grok via xAI behind a swappable `LlmClient`; hosting: Render (worker+relayer) + Vercel (web) + Supabase — team
- Nov 20 — Spec v1.1: sprint seasons, user-signed actions (Approve Big Move, Daily Call, Challenges), QIE components in core, team plan — team
