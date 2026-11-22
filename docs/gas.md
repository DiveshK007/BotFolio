# Gas report

Measured Nov 22 2026 on a QIE mainnet fork (rpc3, around block 12,091,065) with Foundry 1.9.0, solc 0.8.24, shanghai, optimizer 200 runs (SPEC §4.10). Nothing was broadcast.

**Decision for the relayer (SPEC §11): keep the 300,000 cap on the signed `gas` field.** The most expensive relayed call, `executeApproved` with the 5-feed cap check, needs 173,400. That leaves 1.7× headroom.

## How it was measured
`packages/contracts/test/GasLimits.fork.t.sol`:
- Every top-level call runs as its own transaction, so storage is cold, as on mainnet.
- The feeds are the real mainnet bytecode. Only their stored `updatedAt` is moved to "now". A mocked feed is almost free and would hide most of the cap check's cost.
- "Signed gas needed" is found by binary search (to within 50 gas): the smallest `gas` field that works.
- "Tx gas" is the whole transaction: intrinsic, calldata, forwarder and the call.

Regenerate:
```bash
cd packages/contracts
forge test --fork-url qie --match-contract GasLimits --isolate -vv | grep "GAS |"
```
The same test fails CI if any relayed call stops fitting in 300k.

**UNVERIFIED:** `eth_estimateGas` against the deployed contracts. SPEC §4.10 wants that check before launch, and it needs the deploy (#25).

## Relayed calls (user-signed, relayer pays)

| Function | Signed gas needed | Share of 300k | Tx gas | QIE at 1.125 gwei |
|---|---:|---:|---:|---:|
| `BotRegistry.createBot` (includes `initPortfolio`) | 128,063 | 43 % | 188,349 | 0.000212 |
| `BotRegistry.setActive` | 12,157 | 4 % | 72,180 | 0.000081 |
| `SeasonLedger.commitVersion` (includes `setLimits`) | 48,778 | 16 % | 109,421 | 0.000123 |
| `SeasonLedger.recordCorrection` | 39,806 | 13 % | 100,923 | 0.000114 |
| `PaperLedger.executeApproved`, empty portfolio | 109,203 | 36 % | 171,890 | 0.000193 |
| `PaperLedger.executeApproved`, holds all 5 (5-feed cap check) | 159,813 | 53 % | 222,495 | 0.000250 |
| `PaperLedger.executeApproved`, holds 4 and buys the 5th (**worst**) | **173,400** | **58 %** | **236,088** | 0.000266 |
| `DailyCall.call` | 105,394 | 35 % | 167,126 | 0.000188 |
| `Challenges.create` | 113,671 | 38 % | 173,625 | 0.000195 |
| `Challenges.accept` | 60,240 | 20 % | 120,571 | 0.000136 |

"Holds 4, buys the 5th" is the worst case because it still reads all five feeds and also writes a new storage slot for the new holding.

The signed `gas` and the transaction's gas limit are different numbers. Size the transaction with `eth_estimateGas` on `forwarder.execute`. The forwarder adds about 60k on top of the inner call.

## System calls (runner, committer, admin)

| Function | Tx gas | QIE at 1.125 gwei |
|---|---:|---:|
| `executeBatch`: 1 order, empty portfolio | 120,525 | 0.000136 |
| `executeBatch`: 1 order, 5 holdings | 171,111 | 0.000192 |
| `executeBatch`: 1 order, skipped as stale | 61,184 | 0.000069 |
| `executeBatch`: 10 bots, empty portfolios | 850,317 | 0.000957 |
| `executeBatch`: 10 bots, 5 holdings each | 907,449 | 0.001021 |
| `executeBatch`: 50 bots, 5 holdings each | 4,212,212 | 0.004739 |
| `DailyCall.settle`: 1 bot | 51,781 | 0.000058 |
| `DailyCall.settle`: 10 bots | 148,981 | 0.000168 |
| `SeasonLedger.openSeason` | 54,197 | 0.000061 |
| `SeasonLedger.closeSeason` (76-char URI) | 165,120 | 0.000186 |
| `TrustScoreRegistry.publishRules` (76-char URI) | 140,818 | 0.000158 |
| `TrustScoreRegistry.commitScores` (first for a season) | 76,529 | 0.000086 |
| `Challenges.settle` | 46,903 | 0.000053 |
| `Challenges.expire` | 43,802 | 0.000049 |
| `BotRegistry.createHouseBot` (includes `initPortfolio`) | 129,182 | 0.000145 |
| `BotRegistry.setActive` (admin ban) | 55,170 | 0.000062 |

`executeBatch` costs about 40k plus **about 83k per order**, since the feeds are warm after the first order. `DailyCall.settle` costs about 41k plus about 11k per bot.

## Deploy (`script/Deploy.s.sol`, simulated without forge's safety margin)

| Step | Gas |
|---|---:|
| BotForwarder | 899,675 |
| PaperLedger | 2,040,599 |
| BotRegistry | 1,048,887 |
| SeasonLedger | 1,266,296 |
| TrustScoreRegistry | 871,279 |
| DailyCall | 1,504,422 |
| Challenges | 1,120,766 |
| Roles and admin handover | 947,531 |
| **Total** | **9,699,455** (about 0.011 QIE) |

The forwarder is within 0.05 % of the 899,309 in SPEC §0.3.

## QIE bills at least half the gas limit
In 7 recent mainnet transactions sampled on Nov 22 2026, `gasUsed` was exactly half the gas limit every time. WS B saw the same in 19 others. It looks like `billed = max(used, limit / 2)`, as on other Cosmos-EVM chains. The exact rule is **UNVERIFIED**.

So a generous gas limit costs real QIE. Send every transaction (relayer, runner, committer) with an estimate plus a modest margin, below 2× the estimate. The QIE columns above assume that.

## Budget (SPEC §4.10)
```text
runner    = slots(4) × batches × (40,000 + orders_per_batch × 83,000)
relayer   = corrections × 100,923 + daily_calls × 167,126 + approvals × 236,088 + new_users × 188,349
committer = 41,000 + daily_calls × 10,800   + season open/close/scores
cost_QIE  = gas × 1.125e-9
```
Example, as assumptions and not forecasts: 100 bots, one order per bot per slot, and per day one correction and one Daily Call per bot plus 10 new users.

| Wallet | Gas per day | QIE per day | 10 QIE float lasts |
|---|---:|---:|---:|
| Runner (two 50-order batches per slot) | 33.7M | 0.038 | about 260 days |
| Relayer | 28.7M | 0.032 | about 310 days |
| Committer (Daily Call settle) | 1.1M | 0.001 | years |

A 10 QIE float per hot wallet (SPEC §4.10) is plenty at that size. The 2 QIE alert leaves more than 50 days. Both rest on the gas price staying at 1.125 gwei.
