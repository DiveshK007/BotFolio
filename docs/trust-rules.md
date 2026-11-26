# BotFolio trust score rules: trust-v1-sprint and trust-v1

A bot's trust score is a number from 0 to 1000 that says how well it keeps to its own rules, controls losses, stays steady and explains its trades. It is computed at each season close and its Merkle root is committed to `TrustScoreRegistry` on QIE mainnet (chain 1990). Trades are settled against QIE's official mainnet oracle.

Two versions are published with `publishRules`. They score the same way and differ only in when a score counts as provisional:

| Version | Seasons | Provisional when |
|---|---|---|
| `trust-v1-sprint` | S0 to S4 (sprint seasons) | fewer than **8** executed trades, or no completed season |
| `trust-v1` | S5 onwards (weekly seasons) | fewer than **20** executed trades, or no completed season |

The version of each season is in `TrustScoreRegistry.rulesVersionOf(season)`. A version is never edited; a rule change means a new version, and old seasons keep theirs.

## What is scored

Each bot with a result in the season is scored over its whole history up to the season's end (`ends_at`). Data from after the end never counts, so a score can be recomputed at any time and gives the same number.

- **Proposed actions:** the BUY and SELL actions in the bot's decisions (HOLD is not an action).
- **Executed trade:** a `Trade` event emitted by `PaperLedger`.
- **Executed decision:** a decision with at least one executed trade. Trades the owner allowed through Approve Big Move count.
- **Marks:** the bot's portfolio value at each slot, priced with that slot's oracle reads.
- **Daily returns:** the change between consecutive 21:00 IST marks. The first one is measured against the start cash.

## The four factors

Each factor is an integer from 0 to 250, rounded down. The total is their sum.

### F1: follows its rules

`F1 = floor(250 × (1 − penalised / max(1, proposed)))`

An action is penalised when the risk gate clipped or dropped it because of the bot's own choice: for example, too much in one coin, too many trades in a day, not enough cash, nothing to sell, or an order below the minimum size. An action dropped because the oracle price was stale, because the bot was paused, or because it was a second big move in one decision (only one per decision can wait for the owner's approval), is not penalised. Each action is penalised at most once: one that was clipped and then dropped counts once, and so does a stale action whose retry is clipped. Big moves the owner allowed are not penalised.

### F2: drawdown control

`F2 = floor(250 × max(0, 1 − maxDD / 0.30))`

`maxDD` is the largest peak-to-trough fall, as a fraction of the peak. It is taken over the start cash followed by every slot mark in time order, and computed with exact integers. A 30 % drawdown or worse scores 0.

### F3: consistency

`F3 = floor(250 × max(0, 1 − σ / 0.04))`

`σ` is the population standard deviation of the daily returns (divided by their count). With fewer than 3 daily returns, F3 is 125. Returns are rounded to 9 decimal places before σ is taken.

### F4: explains its trades

`F4 = floor(250 × valid / max(1, executed))`

`executed` is the number of executed decisions, and `valid` is how many of them have a reason that passes all of these checks:

1. The reason is 10 to 140 characters long, counted as Unicode code points.
2. It names at least one asset the decision traded, as a whole word in any case: `BTC` or `Bitcoin`, `ETH`, `Ether` or `Ethereum`, `SOL` or `Solana`, `XRP`, `Gold`.
3. Its `reason_tag` is one of `trend_up`, `trend_down`, `buy_dip`, `take_profit`, `cut_loss`, `rebalance`, `persona_preference`, `coach_feedback`, `stay_cash`.
4. The tag fits the trades:
   - `take_profit` and `cut_loss` need at least one SELL;
   - `buy_dip` needs a BUY of an asset whose 24 h change was negative in the decision's logged input;
   - `stay_cash` allows no BUY;
   - every other tag fits any trade.

A bot with no executed decision has F4 = 0.

## Provisional scores

A score is provisional, and shown with a "new" badge, when the bot has fewer executed trades up to the season's end than the version's threshold, or no completed season. The season being closed counts as completed. Provisional bots are left off the Most Trusted board. The flag is not part of the leaf.

## Leaf, root and proof

- **Leaf:** `keccak256(abi.encode(uint32 season, uint256 botId, uint16 fRules, uint16 fDrawdown, uint16 fConsistency, uint16 fExplains, uint16 total))`. This is the same as `TrustScoreRegistry.leafHash`.
- **Root:** a Merkle tree over the leaves in ascending botId order. Each pair is hashed in sorted order (`keccak256` of the smaller hash followed by the larger one), and an odd node moves up a level unchanged. This is the tree that OpenZeppelin's `MerkleProof` verifies.
- **Scores file:** `season-<n>-scores.json`, linked from the `ScoresCommitted` event. It lists every bot's factors, total, provisional flag and leaf. You can rebuild the root from it.
- **Check one bot:** call `TrustScoreRegistry.verifyScore(season, botId, fRules, fDrawdown, fConsistency, fExplains, total, proof)`. It returns true only when the factors add up to the total and the proof leads to the committed root. The worker serves each bot's proof at `GET /trust/proof?season=<n>&bot=<botId>`.

## What the public files contain

The season's replay file (`season-<n>.jsonl`, its Merkle root committed in `SeasonLedger.closeSeason`) holds each decision's logged input and the model's raw output exactly as it came back. The site's content filter hides slurs, real-money advice and links in a reason or roast, but the replay file is not edited: changing it would break the root that proves it. So text the site hid can still be read in the replay file.

Play money. Not investment advice. No prizes.
