# Judge Q&A

Play money. Not investment advice. No prizes.

Short answers to the four questions SPEC §13 says every owner must handle, with file:line pointers so you can open the code while you answer. Then the known limits, said plainly before a judge finds them. Rehearse these in your own words (#122). Don't read them out.

Pointers are to `main` at 5ac9411 (Nov 27 2026). Lines move as PRs merge, so search for the named function if a line is off. Contract code is deployed and won't change. Wording rule: trades are "settled against QIE's official mainnet oracle". Never say "trustless" or "decentralised".

Live: app https://bot-folio.vercel.app · contracts in the [README](../README.md#contracts) · explorer https://mainnet.qie.digital.

---

## 1. "Walk me through the forwarder. Who pays gas?"

**Short answer:** the user signs, our relayer pays, and the contract still sees the user. Every user action is an EIP-712 `ForwardRequest` signed in the browser by the user's passkey wallet. Our relayer checks it and sends it through `BotForwarder`, which is OpenZeppelin's `ERC2771Forwarder`, unchanged. The target contract reads the user from `_msgSender()`, not `msg.sender`. The relayer can refuse to send a request, but it can't forge one: the signature is the user's.

**Walk-through:**
1. The user signs. The request carries `from`, `to`, `value`, `gas`, `nonce`, `deadline` and `data` (`packages/shared/src/relay.ts`).
2. `POST /relay` runs the checks cheapest first (`apps/worker/src/relay/pipeline.ts:42-64`):
   - the caller is signed in, and `from` is one of their wallets (and never our own relayer: `pipeline.ts:45`);
   - the target and function are on the **8-entry allowlist** (`packages/shared/src/relay.ts:245-254`, enforced in `apps/worker/src/relay/policy.ts:17-30`), with `value == 0`, `gas ≤ 300k` and a deadline within 10 min;
   - the 18+ / Terms tick (`pipeline.ts:58-59`), then the rate limits: 30 per wallet a day, 2,000 an hour overall, 3 new bots per IP a day (`apps/worker/src/relay/limits.ts:10-12`).
3. Read-only pre-checks before any gas is spent (`apps/worker/src/relay/chain.ts:20-27`): `forwarder.verify()` (signature, nonce, deadline), an `eth_call` of the inner call to get the revert reason, then `eth_estimateGas`.
4. It broadcasts from a nonce manager, and refuses any gas price above 25 gwei (`apps/worker/src/relay/fees.ts:13`), so a bad RPC quote can't drain the wallet.
5. On-chain: `BotForwarder` (`packages/contracts/src/BotForwarder.sol:12-14`) verifies the signature again and calls the target with the user appended. For example, `PaperLedger.executeApproved` checks `_msgSender() == bot owner` (`packages/contracts/src/PaperLedger.sol:117-118`).

**Why it matters for metrics:** users are counted by `_msgSender`, never by who sent the tx. `/stats` counts only events whose contract checked the owner (`apps/worker/src/stats/stats.ts:7-8`). Relayer, runner and committer txs are listed separately as system txs.

**Show it:** open any user tx on the explorer. `from` is the relayer 0x5955…8004, and the `ExecutedForwardRequest` event's `signer` is the user.

**Why our own forwarder:** QIE has no paymaster or bundler, and ERC-4337 / EIP-7702 aren't available (no Cancun). `docs/decisions.md` Nov 19.

## 2. "What happens when Gold's price is stale?"

**Short answer:** that asset holds and everything else trades. Prices are read inside the contract at execution time, never passed in. If a feed is older than its limit (30 min for crypto, 6 h for Gold), that one order is skipped, and the batch never reverts.

**Walk-through:**
1. The limits are constants in the contract: `packages/contracts/src/lib/QieFeeds.sol:27-28`. Freshness is checked in `lib/OracleReader.sol:40-44` (zero price, incomplete round or future timestamp also count as not fresh).
2. In `PaperLedger._execute` the price is read in the same tx (`PaperLedger.sol:168-170`). Stale means `return (false, STALE)`. `executeBatch` emits `OrderSkipped` and goes on to the next order (`PaperLedger.sol:101-107`). No state is written for a skipped order, so it can be retried.
3. The worker doesn't even send stale orders. The gate drops them (`apps/worker/src/gate/check.ts:38`), and delivery sends only assets that were fresh at the slot (`apps/worker/src/slot/deliver.ts:22-24`). It checks again at +5, +10 and +15 min without calling the LLM again (`apps/worker/src/scheduler/times.ts`, `runbook.md` section 2). Still stale: the bot holds that asset for the slot, and the app shows the price age.
4. The one path that reverts is a single owner-approved big move. The user is waiting, so `executeApproved` reverts with `PriceTooOld` and the app says "try again in a few minutes" (`PaperLedger.sol:128-131`).
5. The Daily Call settle waits for a fresh BTC round from 21:00 (`apps/worker/src/daily-call/settle.ts:46-49`, contract check `packages/contracts/src/DailyCall.sol:101`).

**Be honest:** QIE's crypto feeds are often 45–90 min apart. On Nov 27 at 01:20 IST all four crypto feeds were 52–82 min old, and only Gold was fresh. So many slots hold. That's the rule working, not a bug. Raising the limit would mean trading on prices nobody can check (`docs/oracle-caveat.md`).

## 3. "How does Approve Big Move stop double execution?"

**Short answer:** one order id, one execution. Every order's id is `keccak256(decisionId, actionIndex)`. The contract marks it used when it executes, whichever path runs it: the owner's Allow, or our sweep's shrunk fallback. The second attempt is refused.

**Walk-through:**
1. The gate holds back a buy that would put 30 % or more into one asset, or a sell of 50 % or more of a holding (`apps/worker/src/gate/big-move.ts:6-7`). The runner signs an EIP-712 `ApprovedOrder` for exactly that order, size and a 2 h deadline.
2. **Allow:** the owner relays `PaperLedger.executeApproved(order, runnerSig)` (`PaperLedger.sol:115-134`). This needs two signatures. The caller must be the bot's owner (`:117-118`). The runner's signature must recover to a `RUNNER_ROLE` key and cover every field (`:120-123`, hash at `:137-152`). The deadline must not have passed (`:124`).
3. **Fallback:** if the owner does nothing, the 10-minute sweep shrinks it to just under the threshold and sends it **under the same order id** (`apps/worker/src/big-moves/sweep.ts:35-36`). It checks `usedOrder` first and skips one that already ran (`sweep.ts:93`).
4. **The guard:** `_orderId` (`PaperLedger.sol:249-251`); checked first in `_execute` (`:159-160`); set only after every check passes (`:208`). So whichever lands first wins, and the other gets `USED`: a skip in a batch, or `OrderRejected` for `executeApproved`.
5. **Tests:** `test_approvedThenClippedIsBlocked` and `test_clippedThenApprovedIsBlocked` (`packages/contracts/test/ExecuteApproved.fork.t.sol:327, 339`), `test_replayOfApprovalReverts` (`:321`), `test_used_batchRetryIsANoOp` and `test_usedIsPerActionNotPerDecision` (`packages/contracts/test/ExecuteBatch.t.sol:390, 408`). The forwarder's own nonce stops a replay of the same request (`packages/contracts/test/BotForwarder.t.sol:53`).

**Why per action:** a decision can hold up to 3 actions. A per-decision key blocked actions 2 and 3 (`docs/decisions.md` Nov 20).

## 4. "Why blockchain? Why not a database?"

**Short answer:** so the record can be checked by anyone but us, read by other apps, and kept if we disappear.

1. **Anyone can check, not just us.** Every trade is a `Trade` event with the oracle round it was priced at, read inside the contract (`PaperLedger.sol:168`). Every share card has a "Verify on QIE" link. A screenshot of "my bot made 40 %" can't be faked against that.
2. **Other apps and agents can read it.** The read-only BotFolio MCP server's `verify_trade` re-reads the tx's `Trade` events and each oracle round straight from QIE (`apps/worker/src/mcp/verify-trade.ts:34-37`). The public API is `GET /api/v1/bots/:id/record` (`docs/public-api.md`).
3. **The record outlives the app.** Each bot and every version of its brain belong to the owner's address. Each v2 is a config hash the owner signs (`SeasonLedger.commitVersion`, owner check at `packages/contracts/src/SeasonLedger.sol:72-73`). Each season's replay file has its Merkle root in `SeasonLedger.closeSeason` (`:111-119`, and it can't be closed before its end). Trust scores have their own root (`TrustScoreRegistry.sol:47-55`), locked once the season is closed. `pnpm replay <n> --ledger <SeasonLedger>` recomputes a season from the file and the chain (`docs/replay.md`).

**What we do not claim:** that the LLM is reproducible (it isn't), or that the oracle is independent (one QIE-operated wallet pushes all five feeds, `docs/oracle-caveat.md`). The claim is narrower and true: given the logged LLM output, everything after it (gate, orders, balances, trust scores) is recomputable and anchored on QIE mainnet.

---

## Known limits (say them before you're asked)

| Limit | Where | Why it's acceptable now |
|---|---|---|
| An expired cumulative big SELL can end above 50 % in total. The expiry shrink judges a SELL on the holding at the time it runs | `docs/decisions.md` Nov 26 (#219 Part B/C); master plan D5 | Play money, and the move was already proposed and visible to the owner for 2 h. Fix after Dec 7 |
| A second big move in one decision is dropped, with no F1 (rule-following) penalty | master plan D6, #219 Part C | Keeps one Allow per decision. Simple to explain |
| A big move from the 21:00 slot on a close night can execute after that season's root is committed, so it's in no season's replay file | bug intake Nov 27 (`apps/worker/src/season/close.ts`) | Rare (last slot, owner acts late). Shown on the bot page and on-chain either way |
| Stale feeds mean many slots hold | `docs/oracle-caveat.md` | That is the hard rule: never trade on a price nobody can check |
| One operator for every feed | SPEC §0.2, `/proof` | It's QIE's official mainnet oracle. We say so on `/proof` |
| LLM output isn't reproducible | `docs/replay.md` | We log input, output and hashes. Everything after the output is deterministic |
| S0 (Nov 27–28) is a hidden test season, so boards start at S1 | `docs/decisions.md` Nov 26, #219 | Lets us run a full close on mainnet before the first public one |
| Only S1 closes before the deadline. S2 closes Dec 2 | `packages/db/seeds/seasons.sql` | The deploy moved to Nov 26, and a season can't open before the previous one closes (`SeasonLedger.sol:100`) |
| "Challenge a friend" fails between the 21:30 close and the 00:00 open | bug intake Nov 27 | Retry after 00:00. A fix is planned |
| The 30 s newcomer path isn't measured yet. The first Android passkey alone took about 60 s | master plan §1 | Being measured on phones Nov 27–28. Say the number we measured, not the target |
| QIE Wallet EIP-712 signing on chain 1990 isn't tested yet (#99) | README, QIE components | Connect works. Passkey is the main path |
| The relayer is ours, so it could refuse to send | `apps/worker/src/relay` | It can censor but never forge: every action carries the user's signature, and users could call the contracts directly |
| The worker runs on Render's free plan, kept awake by a 5-min ping | `docs/decisions.md` Nov 26 | Budget. One env change moves it to a paid plan. Restarts are safe by design (`runbook.md` section 1) |
| LLM: Claude Haiku 5.5 with a $4/month cap. At the cap, bots hold ("resting") | `docs/decisions.md` Nov 26, `runbook.md` 3c | Cost control. `LlmClient` swaps the provider by env (`packages/llm`) |

*Play money. Not investment advice. No prizes.*
