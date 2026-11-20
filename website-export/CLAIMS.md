# Claims table (claim → source), re-checked against the final pages on Nov 20

| Claim on site | Source | Label |
|---|---|---|
| Raise an AI trader in one sentence, coach it every season, and let QIE keep score | SPEC §1, CLAUDE.md | — |
| ₹1,00,000 play capital, same for every bot; ₹ = 100000 × value / start | SPEC §1, §3 | — |
| BTC, ETH, SOL, XRP, Gold + cash; long or cash only | SPEC §1 | — |
| 4 decisions a day at 09:00, 13:00, 17:00, 21:00 IST | SPEC §1, §6.1 | — |
| Contract reads QIE oracle at trade time; no price passed in | SPEC §4.3, §5 | — |
| Settled against QIE's official mainnet oracle; one QIE-operated wallet updates feeds | SPEC §0.2 | — |
| Feed addresses, USDT/USD quotes, 8 decimals, max age 30 min / 6 h | SPEC §0.2, packages/shared/assets.ts | VERIFIED Nov 19 |
| Measured gaps: crypto up to 144 min, gold over 6 h | SPEC §0.2 | VERIFIED Nov 19 |
| Chain 1990, explorer mainnet.qie.digital | SPEC §0.1 | VERIFIED Nov 19 |
| Stale price → bot holds; "Gold market quiet — holding"; price-age label rules | SPEC §5.4, §5.7 | — |
| Passkey, no seed phrase, users never pay gas | SPEC §2.1, §4.1, CLAUDE.md | — |
| Approve Big Move: ≥30% buy weight / ≥50% sell; user signature is the trade; 2 h expiry → clipped | SPEC §2.2, §4.3, §6.4 | — |
| Coaching chips (too risky, too timid, wrong coin, sold too early), signed corrections | SPEC §2.2, §4.4 | — |
| v2 diff tied to corrections; Approve → commitVersion; keeps v1 if not approved by 08:30 | SPEC §2.3 | — |
| Daily Call on BTC, settled by the oracle; no stakes | SPEC §2.2, §4.7 | — |
| Challenge links, no stakes | SPEC §2.5 | — |
| Trust score 0–1000, 4 factors × 250, formulas, provisional 8 trades + 1 season (20 from S6) | SPEC §7 | — |
| 4 boards, house bots Steady Sam / Gold Granny / Momentum Max with their rules; house never top spot | SPEC §8 | — |
| Verify on QIE on every card | SPEC §9 | — |
| Public API + read-only MCP: get_bot_record, get_leaderboard, verify_trade; 60 req/min/IP | SPEC §10, §10.1 | COMING |
| Replay command and honest determinism claim | SPEC §6.5 | — |
| 7 contracts, Solidity 0.8.24, OZ 5.0.2, feeds fixed with no setter | SPEC §4, §4.6, §4.9 | addresses [PLACEHOLDER] |
| Deploy ~Nov 22, app ~Nov 25, S1 Nov 26–27 21:30 IST, S5 Dec 4–6 | SPEC §1, §12.3; user brief | — |
| Why blockchain: 3 answers | SPEC §1.1 | — |
| User-signed vs system split, counted by _msgSender | SPEC §11 | empty until live |
| We store wallet address + login id only | SPEC §11 Privacy | — |
| QIE Wallet connect, .qie names, QIE Wallet MCP, QIE Pass | SPEC §0.6 | COMING (UNVERIFIED) |
| Built for QIE Hackathon 3.0, AI + Autonomous Agents track | SPEC §1, CLAUDE.md | — |
| Bots, prices (other than BTC round 50887 and Gold $3,730.84 / round 14811), txs, scores, leaderboards | — | EXAMPLE |
