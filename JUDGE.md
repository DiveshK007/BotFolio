# For judges

Two minutes for the checks, three more for the video. No wallet, no keys, no sign-in: every step reads public data from the live site, the QIE explorer, QIE's RPC or our read-only MCP server.

Play money. Not investment advice. No prizes.

## The path

1. **Watch the walkthrough (2:58.5).** It plays on [/judges](https://bot-folio.vercel.app/judges#demo), with captions, or open the [MP4](https://bot-folio.vercel.app/video/botfolio-demo-walkthrough.mp4) directly. It was recorded on QIE mainnet, and anything that isn't live is labelled on screen. Short on time? The [1-minute trailer](https://x.com/diveshbuilds/status/2126515736873247034) is on X.

2. **Open [/judges](https://bot-folio.vercel.app/judges).** It's a 90-second tour. You get the 7 contracts, each linked to its verified source on the explorer, and the latest trades with their oracle rounds. User activity is counted by the signer's address, with no team filter, and the txs our runner, committer and admin keys send never count as user activity.

3. **Open a trade card and press "Verify on QIE".** [/card/trade-4](https://bot-folio.vercel.app/card/trade-4) is bot 4, Dad's Gold Guard, buying $20,000 of Gold at the Fri 27 Nov 09:00 IST call. The card flips over to show its receipts: the trade tx, its block, oracle round 15050 and QIE's Gold feed. Open the tx [`0x762f…abff`](https://mainnet.qie.digital/tx/0x762f4fef52e75d61846855ecedc8f83f77248d16b37e4ab1d0faee0722ffabff) and go to **Logs**. Log 6 is bot 4's `Trade`, with `priceE8` 362471843240 and `roundId` 15050. Its `cashE8` of 21560000000 is 215.60 play units: every bot starts with 1,078 on-chain, which the app shows as $100,000.

   **Who signed?** Our runner key sent that batch, so it's a system tx. The bot itself was created by its owner's signature. In its [createBot tx](https://mainnet.qie.digital/tx/0x2492ca284a8e71068e6e023b2be3a5ba95700065e800145d40160569e9a31219), `from` is our relayer, and the `ExecutedForwardRequest` log names the owner [`0xa200…859c`](https://mainnet.qie.digital/address/0xa2001Eed46f4c310cE10F31D4A538d78F805859c) as `signer`. That wallet's QIE balance and nonce are both 0, so it has never paid gas.

4. **Check the oracle round yourself.** It takes one call to QIE's Gold feed with `cast` from [Foundry](https://getfoundry.sh):

   ```bash
   cast call 0x9aD0199a67588ee293187d26bA1BE61cb07A214c \
     'getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)' 15050 \
     --rpc-url https://rpc3mainnet.qie.digital
   ```

   ```text
   15050 [1.505e4]
   362471843240 [3.624e11]
   1795748601 [1.795e9]
   1795748601 [1.795e9]
   15050 [1.505e4]
   ```

   The five lines are:
   - the round;
   - its answer, $3,624.71843240 (8 decimals);
   - when it started and when it was last updated (both Fri 27 Nov 08:33:21 IST);
   - the round that answered.

   The answer equals the trade's `priceE8`. `PaperLedger` read it itself inside the tx. An order has no price field, so we can't pass one in.

   <details>
   <summary>No Foundry? The same read with curl</summary>

   ```bash
   curl -s https://rpc3mainnet.qie.digital -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[
          {"to":"0x9aD0199a67588ee293187d26bA1BE61cb07A214c",
           "data":"0x9a6fc8f50000000000000000000000000000000000000000000000000000000000003aca"},
          "latest"]}'
   ```

   The result is five 32-byte words in the same order. The second word, `0x…54650165a8`, is 362471843240.
   </details>

5. **Ask the MCP server.** `verify_trade` reads the tx and each oracle round from QIE mainnet, not from our database:

   ```bash
   curl -s --max-time 90 https://botfolio-worker.onrender.com/mcp \
     -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":4,"method":"tools/call",
          "params":{"name":"verify_trade","arguments":{
          "tx_hash":"0x762f4fef52e75d61846855ecedc8f83f77248d16b37e4ab1d0faee0722ffabff"}}}'
   ```

   Look for `"valid":true,"matches_oracle":true`, and 7 trades in block 12201028, each with `"matches_oracle":true`. For a one-line answer, add `| jq -c '.result.structuredContent | {valid, matches_oracle, block_number, trades: (.trades | length)}'`. The worker is on Render's free plan, so the first call after a quiet spell can take up to a minute. An MCP client can connect to the same URL; the walkthrough shows a Claude Code session making this call ([docs/mcp-demo.md](docs/mcp-demo.md)).

6. **Replay a season once it has closed.** Season 0, the hidden test season, ends on-chain at **Sat 28 Nov 21:30 IST**, and our committer closes it after that. Before the close there's no replay file, and the replay exits 2 with "Season 0 isn't closed on-chain yet, so it has no file." After the close, run it from a fresh clone. You need Node 20, and `corepack enable` gives you pnpm 9.12.0:

   ```bash
   git clone --depth 1 https://github.com/DiveshK007/BotFolio && cd BotFolio
   pnpm install --frozen-lockfile && pnpm --filter @botfolio/replay build
   pnpm replay 0 --ledger 0x32883A866e73BABB980c457C6c6A256fb6D9f902
   ```

   The replay does four things:
   - re-runs the risk gate on every logged AI output;
   - re-reads each oracle round from QIE;
   - recomputes every bot's cash and holdings from its `Trade` events;
   - checks the data root against `SeasonLedger`.

   Exit 0 means everything matches, 1 means a mismatch, and 2 means bad usage or no file ([docs/replay.md](docs/replay.md)). Install and build took 23 s in our dry run. To see whether the close has landed:

   ```bash
   cast call 0x32883A866e73BABB980c457C6c6A256fb6D9f902 \
     'seasons(uint32)(uint64,uint64,bytes32,string,bool)' 0 \
     --rpc-url https://rpc3mainnet.qie.digital
   ```

   Once Season 0 is closed, the last line reads `true`, with the data root and the replay file's URL above it. Season 1, the first public season, closes Mon 30 Nov 21:30 IST.

## What is EXAMPLE or not live yet

| What | Status | Detail |
|---|---|---|
| The landing's coaching walkthrough (AlphaWolf: "too risky" → max per coin 40% → 25%) | **EXAMPLE** | Labelled on the page. /judges shows the same "hero moment" labelled EXAMPLE |
| The landing's Daily Call | **Practice** | Runs in your browser, and nothing goes on-chain. The on-chain Daily Call is in the app |
| Season 0's close, replay file and trust scores, and the v2 proposals that follow | **After Sat 28 Nov 21:30 IST** | /stats shows 0 season roots and 0 trust score roots until then |
| QIE Wallet connect | **In testing** | Connect works, but signing on chain 1990 isn't tested yet ([#99](https://github.com/DiveshK007/BotFolio/issues/99)). Passkey is the main path |
| QIE Pass | **Coming** | An optional "verified human" badge. It needs partner access ([#110](https://github.com/DiveshK007/BotFolio/issues/110)) |
| Coaching corrections, v2 approvals, approved big moves, Daily Calls, challenges | **Built, not used on mainnet yet** | 0 of each in /stats at 10:36 IST on Sat 28 Nov |
| Which model made a given call | **UNVERIFIED** | Production is set to Claude Haiku 5.5 (`render.yaml`; [docs/AI_USAGE.md](docs/AI_USAGE.md)). Each decision's model id is in the season's replay file, so you can check it after the close |

Everything else in the path above is live: the 7 verified contracts, bot 4 and its owner-signed creation, the 09:00 batch with its 7 trades, and oracle round 15050 are on QIE mainnet, and the MCP server (on Render) answers live.

## What these checks don't prove

- **That a round was the newest one.** `verify_trade` checks that each price equals its round's answer. Freshness is the contract's job: it never trades on a crypto price older than 30 min or a Gold price older than 6 h. Bot 4's round was 26 min 43 s old when the batch was mined: it was updated at 08:33:21 IST and the batch was mined at 09:00:04 IST.
- **That the AI decided well.** It's play money. We claim the record can be checked, not that the bot is smart.
- **Who the person is.** A user is a wallet. The human check, QIE Pass, isn't live.
- **That the AI would give the same answer again.** It wouldn't. The replay recomputes everything after the logged output.

## Known limits

- **Activity is small.** At 10:36 IST on Sat 28 Nov, [/stats](https://bot-folio.vercel.app/stats) counted 4 user-signed txs from 4 wallets, one `createBot` each (bots 4 to 7), and 4 system txs (1 runner batch, 3 house bots); it doesn't count season opens, rule publishes or reverted txs. A user is the signer the contract checked (`_msgSender`), never the address that paid the gas. /stats has no team filter, so whether any of these wallets is a teammate's is UNVERIFIED.
- **Stale feeds mean many slots hold.** At 10:36 IST only BTC and ETH were fresh. SOL was 1 h 34 min old, XRP 2 h 28 min and Gold 9 h 19 min, so /healthz said "degraded". A stale asset is skipped and holds; a stale price never reverts the batch ([docs/oracle-caveat.md](docs/oracle-caveat.md)).
- **One operator for all five feeds.** A single QIE-operated wallet pushes every update, and /proof says so. Trades are settled against QIE's official mainnet oracle, so they're only as good as that feed.
- **The relayer is ours.** It can refuse to send a request, but it can't forge one, because every action carries the user's own EIP-712 signature.
- **Free hosting, small AI budget.** The worker runs on Render's free plan, kept awake by a 5-minute outside ping (UNVERIFIED). The LLM cap is $4 a month, and at the cap bots hold. /healthz read $0.0018 spent at 09:03 IST, and $0 after the worker restarted at 09:27 IST. The next slot reloads the month's decision spend from the decisions log; persona spend is counted in memory, so a restart forgets it.
- **One public season before the deadline.** Season 0 is hidden, so the boards start at Season 1 (Sun 29 Nov 00:00 → Mon 30 Nov 21:30 IST).
- **Phones.** Passkey sign-up works on Android, where the first passkey took about 60 s. iPhone Safari is UNVERIFIED.

The README's [What's real](README.md#whats-real) table has the rest. [docs/judge-qa.md](docs/judge-qa.md) has the four questions every owner answers, with file:line pointers. [docs/AI_USAGE.md](docs/AI_USAGE.md) says how we used AI.

## Last verified

Sat 28 Nov 2026, 10:35–11:03 IST. All checks were read-only.

| Check | Result |
|---|---|
| Step 4: `cast call` on round 15050 | The five lines above. Chain id 1990. The feed's `decimals()` is 8 and its `description()` is "Gold / USD" |
| Step 5: MCP `verify_trade` | `valid: true`, `matches_oracle: true`, 7 of 7 trades, block 12201028. Log 6 is bot 4's Gold buy |
| Explorer API and `cast receipt`: tx `0x762f…abff` | Success. Block 12201028 at 09:00:04 IST, sent from our runner `0x33b6…A181` to `PaperLedger.executeBatch` |
| Explorer API and `cast receipt`: tx `0x2492…1219` | Success. Sent from our relayer `0x5955…8004` to `BotForwarder`, with `signer` `0xa200…859c` |
| RPC and the QIE Wallet MCP: the 4 owners (bots 4 to 7) | Each wallet's balance is 0 and its nonce is 0. None has a `.qie` name |
| Explorer API: the 7 contracts | All `is_verified: true`, solc 0.8.24, EVM shanghai |
| RPC: `SeasonLedger.seasons(0)` | Not closed yet. It ends at 1795881600 (Sat 28 Nov 21:30 IST), and its data root is zero |
| Worker `/healthz` and `/stats` | Both 200. "degraded": SOL, XRP and Gold stale. LLM provider `anthropic`, $0 of $4 since the 09:27 restart. 4 user-signed txs from 4 signers, and 4 system txs |
| Site: `/judges`, `/proof`, `/stats`, `/bot/4`, `/card/trade-4` | All 200. The card's "Verify on QIE" receipts link the tx and the feed above |
| Walkthrough MP4 | 200, `video/mp4`, 2:58.5 (ffprobe: 178.517 s) |
| `/judges#demo` | Has the walkthrough's `<video>`, with an English captions track (the `.vtt` answers 200) |
| Trailer on X | The post is live (oEmbed answers 200, dated Nov 28, 2026, with media). Its video length isn't checked |
| **Not checked** | The replay, because Season 0 isn't closed yet |
