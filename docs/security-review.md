# Contract security review (issue #30)

Scope: the 7 contracts in `packages/contracts/src`, the deploy script, and the relayer allowlist in
`apps/worker/src/relay`. Checked against SPEC §4 (§4.6 access control) and §11. Reviewed Nov 25 2026 on
`main` at `cdbee62`.

**Result: no vulnerability found.** Every item below is OK. The "Notes" section lists trust assumptions
that are by design, so a judge or a future owner can see them in one place.

Legend: **OK** = matches the spec and has evidence. **ISSUE** = does not (none open). Fork tests need a QIE
RPC and run in CI (`.github/workflows/contracts.yml`).

## 1. Privileged functions, per contract

`DEFAULT_ADMIN_ROLE` is OZ's `0x00` and is the cold key (SPEC §4.6). Every role check (`onlyRole`,
`hasRole(…, _msgSender())`) uses `ERC2771Context._msgSender()`, picked once in
`src/base/ForwarderAccess.sol:23`.

| Contract | Function | Who may call | Status | Evidence |
|---|---|---|---|---|
| BotForwarder | `execute`, `executeBatch`, `verify` | anyone, with a valid EIP-712 signature (OZ 5.0.2, unchanged) | OK | `src/BotForwarder.sol:12-14` |
| BotRegistry | `createBot` | any user, owner = `_msgSender()`, 1 per wallet | OK | `src/BotRegistry.sol:49-60` |
| BotRegistry | `createHouseBot` | `DEFAULT_ADMIN_ROLE` | OK | `src/BotRegistry.sol:63-72` |
| BotRegistry | `setLimits` | `SEASON_LEDGER_ROLE` (held by the SeasonLedger contract only) | OK | `src/BotRegistry.sol:74-86`, `script/Deploy.s.sol:119` |
| BotRegistry | `setActive` | bot owner (pause) or `DEFAULT_ADMIN_ROLE` (ban; owner can't undo a ban) | OK | `src/BotRegistry.sol:89-104` |
| PaperLedger | `initPortfolio` | `REGISTRY_ROLE` (held by the BotRegistry contract only) | OK | `src/PaperLedger.sol:93`, `script/Deploy.s.sol:118` |
| PaperLedger | `executeBatch` | `RUNNER_ROLE` | OK | `src/PaperLedger.sol:101` |
| PaperLedger | `executeApproved` | bot owner via `_msgSender()` + a `RUNNER_ROLE` EIP-712 signature | OK | `src/PaperLedger.sol:115-123`; `test/ExecuteApproved.fork.t.sol` (`test_onlyOwner`, `test_signatureFromNonRunner`, `test_revokedRunnerSignatureStopsWorking`) |
| SeasonLedger | `commitVersion` | bot owner, or `DEFAULT_ADMIN_ROLE` for house bots only | OK | `src/SeasonLedger.sol:64-82` |
| SeasonLedger | `recordCorrection` | bot owner, 20/day cap | OK | `src/SeasonLedger.sol:84-95` |
| SeasonLedger | `openSeason`, `closeSeason` | `COMMITTER_ROLE` | OK | `src/SeasonLedger.sol:97`, `:109-111` |
| TrustScoreRegistry | `publishRules` | `DEFAULT_ADMIN_ROLE` | OK | `src/TrustScoreRegistry.sol:29-31` |
| TrustScoreRegistry | `commitScores` | `COMMITTER_ROLE` | OK | `src/TrustScoreRegistry.sol:43-45` |
| DailyCall | `call` | bot owner via `_msgSender()` + a `RUNNER_ROLE` signature over `(botId, day, botUp)` | OK | `src/DailyCall.sol:66-80`; `test/DailyCall.fork.t.sol` (`test_call_ownerOnly`, `test_call_sigFromUserReverts`, `test_call_revokedRunnerReverts`) |
| DailyCall | `settle` | `COMMITTER_ROLE` | OK | `src/DailyCall.sol:94` |
| Challenges | `create`, `accept` | bot owner via `_msgSender()` | OK | `src/Challenges.sol:48-50`, `:63-68` |
| Challenges | `settle` | `COMMITTER_ROLE` | OK | `src/Challenges.sol:85` |
| Challenges | `expire` | anyone (only tidies a challenge whose season has closed) | OK | `src/Challenges.sol:99-107` |
| all 6 role contracts | `grantRole`, `revokeRole` | `DEFAULT_ADMIN_ROLE` (OZ default role admin) | OK | no `_setRoleAdmin` anywhere in `src/`; `test/Deploy.fork.t.sol` `test_roleAdminIsColdKeyOnly` (new) |
| all 6 role contracts | `renounceRole` | the holder itself | OK | OZ 5.0.2 `AccessControl` |

## 2. Role and key checks

| Item | Status | Evidence |
|---|---|---|
| No feed or maxAge setter; prices are read inside the contracts | OK | `src/lib/QieFeeds.sol:21-28` (constants), `src/PaperLedger.sol:68-76` (`pure` views); `test/Surface.fork.t.sol` `test_feedsAndMaxAgesLiveInBytecode`, `test_feedsAreTheSpecAddresses` |
| No price is ever a function input | OK | `src/PaperLedger.sol:169`, `src/DailyCall.sol:82`, `:95` |
| No `payable`, no token transfer, no `delegatecall`/`selfdestruct` in our code | OK | grep of `src/` finds only the OZ forwarder interface's `payable` |
| No `msg.sender` or `tx.origin` in our contracts | OK | grep of `src/` is empty |
| Role admin is the cold admin only; no hot key can grant or take admin | OK | `test/Deploy.fork.t.sol` `test_roleAdminIsColdKeyOnly` (new), `test/AccessRoles.t.sol` `test_onlyAdminGrants` |
| Deploy grants exactly SPEC §4.6: admin everywhere, RUNNER on PaperLedger + DailyCall, COMMITTER on SeasonLedger + TrustScoreRegistry + DailyCall + Challenges, REGISTRY and SEASON_LEDGER to the contracts | OK | `script/Deploy.s.sol:117-128`; `test/Deploy.fork.t.sol` `test_exactlyTheExpectedRolesExist` (replays the logs: 14 grants, no others) |
| Deployer keeps nothing when the cold key is another address (grant first, then renounce) | OK | `script/Deploy.s.sol:132-140`, `:148-150`; `test/Deploy.fork.t.sol` `test_relayerDeployerAndForwarderHaveNoRole` |
| Relayer has no role (SPEC §4.6) | OK | `script/Deploy.s.sol:151-153`; `test/Deploy.fork.t.sol` `test_relayerDeployerAndForwarderHaveNoRole`, `test/AccessRoles.t.sol` `test_relayerHasNoRole` |
| Admin, runner, committer, relayer are 4 different keys; the deployer is none of the hot ones | OK | `script/Deploy.s.sol:86-96`; `test/Deploy.fork.t.sol` `test_rejectsSharedKeys`, `test_rejectsDeployerAsHotWallet` |
| The worker refuses to start a wallet whose key equals another wallet's | OK | `apps/worker/src/system/key.ts:5-14` |
| No admin key on the server: the worker reads only relayer, runner and committer keys | OK | `apps/worker/src/system/key.ts:6`; `.env.example:25` marks `DEPLOYER_PRIVATE_KEY` local only |
| A forged calldata suffix can't spoof `_msgSender()` | OK | `test/AccessRoles.t.sol` `test_cannotSpoofSenderWithCalldataSuffix` |

## 3. Relayer allowlist vs SPEC §11

| Item | Status | Evidence |
|---|---|---|
| The allowlist is exactly the 8 user-signed calls in SPEC §11 | OK | `packages/shared/src/relay.ts:245-254`; `apps/worker/test/relay/allowlist.test.ts` "is exactly the 8 user-signed calls SPEC §11 names" (new, list typed by hand from SPEC) |
| Each selector is derived from the frozen ABIs, and the worker won't load if one differs | OK | `apps/worker/src/relay/allowlist.ts:9-22`; `allowlist.test.ts` "derives exactly the 8 signatures and selectors" |
| Every other state-changing function in the 5 target ABIs is refused (runner, committer, contract-only, admin, `grantRole`/`revokeRole`/`renounceRole`, `Challenges.expire`) | OK | `allowlist.test.ts` "refuses %s on its own contract" (new, enumerates the ABIs: 24 functions) |
| An allowlisted selector is refused on any other target | OK | `allowlist.test.ts` "refuses %s's selector on every other target" |
| `value == 0`, `gas ≤ 300k`, deadline ≤ 10 min | OK | `apps/worker/src/relay/policy.ts:20-31`; `allowlist.test.ts` policy tests |
| The relayer only sends `forwarder.execute`, after `forwarder.verify()` and an `eth_call` of the request | OK | `apps/worker/src/relay/chain.ts:48`, `:83` |
| TrustScoreRegistry is not a relay target (no user calls it, it trusts no forwarder) | OK | `apps/worker/src/relay/abis.ts:13-19`, `src/TrustScoreRegistry.sol:11` |

## 4. `_msgSender()` on every user-signed function

All 8 relayed functions read the user with `_msgSender()`. `test/ForwarderMsgSender.fork.t.sol` sends each
one through the real forwarder and checks the signer, not the relayer, is the actor: `test_createBot`,
`test_setActive`, `test_commitVersion`, `test_recordCorrection`, `test_executeApproved`, `test_dailyCall`,
`test_challengeCreate`, `test_challengeAccept`. Coverage: 8 of 8. **OK**

## 5. Slither (issue #153)

CI runs slither 0.11.6 on every contracts PR and fails on any High (`.github/workflows/contracts.yml:109-130`).
The last run on `main` (run 45639516632, Nov 25) passed with 0 High and 31 lower findings. Triage:

| Detector | Where | Verdict |
|---|---|---|
| divide-before-multiply (×3) | `src/PaperLedger.sol:186-192`, `:198-199` | Accepted. Each step rounds down, which only ever gives the bot slightly less. Play money, no value leaves. |
| incorrect-equality | `src/PaperLedger.sol:174` (`p.lastDay == day`) | False positive: comparing IST day numbers is intended. |
| unused-return | `src/DailyCall.sol:77`, `src/PaperLedger.sol:120` (`tryRecover`'s 3rd value) | False positive: the error code is checked; the 3rd value only repeats it. |
| calls-loop | `src/PaperLedger.sol:165` (`getBot` in `executeBatch`) | Accepted. The registry is our own immutable contract; a bad bot is skipped, never reverts the batch. |
| timestamp | `DailyCall.call`, `PaperLedger.executeApproved`, `_execute` | Accepted. Day windows and deadlines are minutes to hours wide; a few seconds of validator drift doesn't matter. |
| dead-code | `src/base/ForwarderAccess.sol:27` (`_msgData`) | Accepted. Required override to resolve the two OZ parents. |
| naming-convention | various | Style only. |

`forge` and `slither` are not installed on the reviewer's machine, so this pass relies on CI for both.

## Notes: trust assumptions by design (not bugs)

- **Runner key compromise** lets an attacker trade any bot within its limits, and sign any
  `ApprovedOrder` or bot view. That is the authority SPEC §4.2 gives the runner. Fix: the cold key revokes
  `RUNNER_ROLE`, and old runner signatures stop working at once (`test_revokedRunnerSignatureStopsWorking`,
  `test_call_revokedRunnerReverts`).
- **Committer key compromise** can open or close seasons with any root, settle challenges or daily calls, and
  overwrite a season's `scoresRoot` (`commitScores` isn't write-once, SPEC §4 allows an optional daily root).
  Every write emits an event, so the history stays public, and the published numbers can be recomputed
  off-chain. `closeSeason` is write-once (`src/SeasonLedger.sol:113`).
- **Cold admin** can grant `REGISTRY_ROLE` or `SEASON_LEDGER_ROLE` to any address. That is admin power; the
  bounds in `setLimits` and the once-only `initPortfolio` still apply.
- **DailyCall:** the signed request carries `botUp`, so a user who reads it before signing knows the bot's
  pick. They can copy or oppose it but can't change it, so the board can't be rigged. "Shown after you
  pick" is a UI rule.
- **House bots** are owned by the cold key, so their version commits and approvals need the cold key to sign.
- **ERC-2771 + Multicall** (OZ advisory, Dec 2023) doesn't apply: no contract uses `Multicall`.
- **Never** put `DEPLOYER_PRIVATE_KEY` or the admin key on Render or Vercel. If the deploy runs from the cold
  key itself (`test_deployerAsColdKey`), that key stays offline.
