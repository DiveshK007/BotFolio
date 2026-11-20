# Decision log
Format: date — decision — why — who.

- Nov 19 — Product: BotFolio (AI paper-trading bots, play money), AI + Autonomous Agents track — best fit of ship speed, solo loop and QIE oracle use — team
- Nov 19 — Pin `@openzeppelin/contracts@5.0.2`, solc 0.8.24, `evm_version=shanghai` — QIE mainnet has no Cancun; OZ 5.6.1 uses `mcopy` — team
- Nov 19 — Gas sponsored via own ERC-2771 forwarder + relayer — QIE has no paymaster/bundler — team
- Nov 19 — LLM: Grok via xAI behind a swappable `LlmClient`; hosting: Render (worker+relayer) + Vercel (web) + Supabase — team
- Nov 20 — Spec v1.1: sprint seasons, user-signed actions (Approve Big Move, Daily Call, Challenges), QIE components in core, team plan — team
- Nov 20 — Replay protection per order: `orderId = keccak256(decisionId, actionIndex)` — a decision can hold up to 3 actions; a per-decision key blocked actions 2 and 3 — Divesh
- Nov 20 — Daily Call bot view must carry a runner EIP-712 signature — otherwise the user's own tx chooses the bot's answer — Divesh
- Nov 20 — `setLimits` enforces the same bounds as `createBot` (10–50 % per coin, 1–8 trades/day) — keeps leaderboards fair — Divesh
- Nov 20 — Relay accepts a Privy token or a SIWE-style JWT — QIE Wallet users have no Privy session — Divesh
- Nov 20 — Daily Call settle retries every 10 min to 23:50 IST, then at the next 09:00 slot — BTC rounds can be 45–104 min apart — Divesh
- Nov 20 — Challenge codes derived by the contract — client-chosen codes can be front-run — Divesh
- Nov 20 — Users must be 18+ (Terms + one-line confirmation at sign-up) — Divesh
- Nov 20 — Testnet staging dropped; staging = local mainnet fork (Anvil) — testnet RPC unreliable and testnet feed addresses unknown — Divesh
- Nov 20 — Reference screenshots kept out of git (GitHub Release) — ~23 MB of PNGs would bloat history for good — Divesh
