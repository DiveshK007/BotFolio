# Oracle caveat

Every trade is **settled against QIE's official mainnet oracle**. That is as strong as the claim gets. We never call it trustless or decentralised.

## What the oracle is

- The 5 feeds are QIE's `AggregatorV3` contracts: BTC, ETH, SOL, XRP (quoted in USDT) and Gold (quoted in USD). Addresses are constants in [`QieFeeds.sol`](../packages/contracts/src/lib/QieFeeds.sol), with no setter, and mirror [`packages/shared/src/assets.ts`](../packages/shared/src/assets.ts). Changing a feed means redeploying.
- **One QIE-operated wallet pushes all updates** (SPEC §0.2, checked Nov 19 2026). A trade is only as good as that feed. The app says so on `/proof`.
- QIE and BNB feeds exist but are not wired.

## Update gaps (measured Nov 19 2026, SPEC §0.2)

| Asset | Median gap | Max gap seen |
| :--- | :--- | :--- |
| BTC | 10.5 min | 104 min (last 25 rounds) |
| ETH | 8 min | 46 min (last 40) |
| SOL | 12 min | 84 min (last 40) |
| XRP | 9 min | 144 min (last 40) |
| Gold | 78 min | 552 min; 5 of 19 gaps over 2 h; one 9.2 h gap in the sample |

One sample from one afternoon. UNVERIFIED as a long-run figure; re-measure before quoting it elsewhere.

## Max ages

| Assets | Max age | Where |
| :--- | :--- | :--- |
| BTC, ETH, SOL, XRP | 30 min (1800 s) | `CRYPTO_MAX_AGE` in `QieFeeds.sol`; `maxAgeSeconds` in `assets.ts` |
| Gold | 6 h (21600 s) | `GOLD_MAX_AGE` in `QieFeeds.sol`; `maxAgeSeconds` in `assets.ts` |

[`OracleReader.sol`](../packages/contracts/src/lib/OracleReader.sol) also rejects a price with a non-positive answer, `updatedAt == 0`, or an incomplete round (`answeredInRound < roundId`; a feed that returns 0 there is accepted, UNVERIFIED behaviour per SPEC §5).

## Stale means skip and hold

- `PaperLedger.executeBatch` never reverts on a bad price. A stale or unreadable feed makes that order return a skip reason and emit `OrderSkipped`, and the loop continues. One stale asset never blocks other assets or other bots ([`PaperLedger.sol`](../packages/contracts/src/PaperLedger.sol)).
- The runner retries stale actions at +5, +10 and +15 min under the same order ids. A skipped order leaves no trace, so the retry is allowed.
- Still stale after that: the bot holds that asset and the app shows "market quiet, holding", not an error.
- The one path that reverts is `executeApproved` (a single owner-approved big move): it reverts with `PriceTooOld` on a stale feed.
- Portfolio marks use the latest answer even when it is older than the max age, so a value can rest on an old price. Every price and mark shows its age.

## Prices are read inside the contracts

`PaperLedger` and `DailyCall` call `latestRoundData()` on the feed at execution time and store the round id with the trade. Nobody passes a price in, including us. Off-chain reads are only for the LLM prompt and the UI. Anyone can re-check a trade with `getRoundData(roundId)`: the MCP `verify_trade` tool and `pnpm replay` both do ([replay.md](replay.md)).

## What this does not protect against

If QIE's operator pushes a wrong or late price, our trades inherit it. We do not cross-check against another source.
