# Open questions (and the decision taken for each)

| # | Question | Decision taken | Who should confirm |
|---|---|---|---|
| 1 | Leaderboard tabs: S6 lists 3, SPEC §8 lists 4, the brief says "Steadiest" | 4 tabs using §8 names; "Best Risk-Adjusted", not "Steadiest" | Divesh |
| 2 | **Best Risk-Adjusted can't fill in sprint seasons**: §8 needs ≥3 daily returns, but S1–S4 last 2 days (2 marks) | Board shows an honest empty state until S5. Fix in spec: lower to ≥2 during sprint, or use slot marks | WS B / Divesh |
| 3 | Spec example prompt "Buys dips on SOL and XRP, takes profit fast" breaks the no-"profit" rule | Site uses "…sells fast on the way up". App's S1 chips should match | WS C |
| 4 | Spec's viral example "lost ₹12,400 going all-in on gold at 2 AM": no 2 AM slot (09/13/17/21 IST) and the 50% cap prevents all-in | Card says "going big on Gold at the 21:00 call" | WS D (card copy) |
| 5 | `/stats` vs `/proof`: spec names both | `/stats` redirects to `/proof#stats` | WS C |
| 6 | Audience 4 (devs/agents) has no screen in S1–S11 | Added `/developers` | Divesh |
| 7 | No brand assets exist | Proposed: signal-blue/sunflower palette, Archivo/Inter/JetBrains Mono, original geometric bot-head mascot | Divesh |
| 8 | Bot avatar colours aren't in the data model | `color` optional on Bot; derived from id when absent | WS B (optional column) |
| 9 | Live holdings need a price + age for the mandatory price-age label | Record payload needs `priceE8` + `priceAgeMin` per holding | WS D |
| 10 | Supabase view/RPC names for site reads | Proposed `site_latest_trades`, `site_activity_stats`, `site_leaderboards(season)`, `site_cards` (public read via RLS) | WS B |
| 11 | Traction numbers before launch | Never shown, not even as EXAMPLE, in the real site. The prototype has a review-only preview toggle | — |
| 12 | Demo video, live app URL, domain, contact email, replay file URL | Visible [PLACEHOLDER]s | Divesh / WS D |
| 13 | "Pokémon" tagline | Not used (third-party trademark) | — |
| 14 | Price/₹ examples for ETH, SOL, XRP aren't in the spec | Made-up sample values, labelled EXAMPLE. Live oracle prices replace them as soon as the RPC is reachable | — |
| 15 | OG titles use the default Satori font (regular weight) | Fine for launch; optionally load Archivo 800 into `ImageResponse` | WS D |
