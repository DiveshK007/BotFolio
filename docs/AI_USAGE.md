# How we used AI

AI shows up in BotFolio in two places. Inside the product, an LLM writes each bot's persona and makes its trading calls. While we built it, Claude Code helped write code and docs. This page says where AI was used, how much, and how you can recount it. Git and GitHub counts are from `main` at [`723b0fd`](https://github.com/DiveshK007/BotFolio/commit/723b0fd50f2114696302f3e4c13c818501d91632) (Sat 28 Nov 2026, 00:47 IST).

Play money. Not investment advice. No prizes.

## At a glance

| | Count |
|---|---|
| Non-merge commits on `main` | 430 |
| ...with a `Co-Authored-By: Claude` trailer | 189 (44 %), a floor: see [Claude Code](#claude-code) |
| ...made by Cursor's agent | 2 |
| ...dependency bumps by dependabot (automation, not AI) | 7 |
| Merged PRs with comments from GitHub's Copilot reviewer | 149 of 156 |
| Decision-log entries made with Claude | 14 of 41 |
| LLM in the product | Set to Claude Haiku 5.5 on the Anthropic API since Thu 26 Nov ([render.yaml](../render.yaml); `/healthz` shows the provider) |
| This README, JUDGE.md, this page and the README images | Drafted by Claude Code on Sat 28 Nov ([details](#other-ai-tools)) |

## Tools

- **Claude Haiku 5.5** (`claude-haiku-5-5`) runs inside the product, behind our own `LlmClient` interface ([`packages/llm`](../packages/llm)). That's part of the product, not help with building it.
- **Claude Code (Opus 5.5)** is our coding assistant. Its sessions follow [CLAUDE.md](../CLAUDE.md), the project's rules, and [SPEC.md](../SPEC.md), the source of truth.
- **Claude Design** made the website's design export ([`website-export/`](../website-export), Fri 20 Nov). The app's colours and fonts come from it.
- **Cursor's agent** made 2 docs commits on Nov 20–21.
- **GitHub Copilot's PR reviewer** left automatic comments on 149 of the 156 merged PRs.
- **ElevenLabs** text-to-speech reads the narration in the demo videos.

## AI in the product

### What the LLM does

| Job | When | What it writes | What bounds it |
|---|---|---|---|
| **Persona** | When you type one sentence | A name, an emoji, a persona and rules, plus two limits: max per coin (10–50 % in steps of 5) and max trades a day (1–8). The bot's face isn't the model's: it's drawn from a hash of your sentence | The output schema ([`persona/schema.ts`](../apps/worker/src/persona/schema.ts)). `BotRegistry` enforces the same limits on-chain |
| **The call** | 09:00, 13:00, 17:00 and 21:00 IST, for every player's bot | Up to 3 actions (buy, sell or hold one of the five assets), a reason, a tag and a roast. At 09:00 it also picks BTC up or down for the Daily Call | `gate()`, then the contract |
| **v2 proposal** | At each season close | A new config, based on the owner's corrections and the season's results | Only the owner's signature commits it. Otherwise the bot keeps its version ([`v2/propose.ts`](../apps/worker/src/v2/propose.ts)). If the model fails, a fixed rule moves one slider one step |

Every call goes out under a strict JSON schema. On Anthropic it's a forced tool call with thinking disabled ([`anthropic.ts`](../packages/llm/src/anthropic.ts)). The runner only ever sees `LlmClient`, never a provider SDK, so switching provider is one env change ([decisions.md](decisions.md), Nov 26). The three house bots (Steady Sam, Gold Granny and Momentum Max) use fixed rules, not the LLM ([`house/strategies.ts`](../apps/worker/src/house/strategies.ts)).

"Talk to a bot" would give short in-character replies based only on a bot's public record ([`api/site/talk`](../apps/web/app/api/site/talk/route.ts)). It stays off unless `TALK_ENABLED=true` ([env.md](env.md)), and it's off in production: `/api/site/talk` answered 503 `talk_disabled` on Sat 28 Nov at 10:40 IST.

### The gate that bounds it

`gate()` ([`apps/worker/src/gate/gate.ts`](../apps/worker/src/gate/gate.ts)) is a pure function: no clock, no I/O and no randomness. Every output goes through it before anything is sent:

1. If the output doesn't match the schema, it's invalid and the bot holds.
2. A stale asset is dropped: crypto older than 30 min, or Gold older than 6 h.
3. A buy is clipped to the bot's max per coin, and the trades-a-day limit is enforced.
4. Orders under 1 % of the portfolio are dropped. No order can spend more than the cash or sell more than the holding, so there's no leverage and no shorting.
5. Some moves wait for the owner to Allow, Shrink or Block them: a buy that would put 30 % or more into one asset, or a sell of 50 % or more of a holding.
6. Banned words in the reason or the roast are hidden. The orders don't change.

The 60 gate tests passed in our last run (`pnpm --filter @botfolio/worker exec vitest run test/gate.test.ts`, Fri 27 Nov 22:57 IST).

The contract then checks everything again. Trades are settled against QIE's official mainnet oracle: `PaperLedger` reads the price from QIE's feed inside the tx. An order has no price field, only `botId, asset, buy, bps, decisionId, actionIndex`, so neither the model nor our runner can choose a price. If a price is stale, that order is skipped, and the rest of the batch still goes through.

So the model can't:
- set a price;
- go past its bot's limits;
- trade a stale asset;
- sign for a user;
- touch real money (there is none).

### What we log

The season's replay file holds each decision's model id, prompt version, input and input hash, and the model's raw output ([`season/replay-file.ts`](../apps/worker/src/season/replay-file.ts)). The file is public, and its Merkle root is committed in `SeasonLedger.closeSeason`. The model's answer isn't reproducible, so we log it and don't regenerate it. `pnpm replay` recomputes everything after it ([replay.md](replay.md)).

### Cost and limits

- A decision call costs about $0.0005. We cap spending at $4 a month on a $5 balance, and at the cap bots hold ("resting") ([decisions.md](decisions.md), Nov 26).
- `/healthz` read $0.0018 spent in November at 09:03 IST on Sat 28 Nov, and $0 after the worker restarted at 09:27 IST. The next slot reloads the month's decision spend from the decisions log ([`budget/spend.ts`](../apps/worker/src/budget/spend.ts)); persona spend is counted in memory, so a restart forgets it ([`health.ts`](../apps/worker/src/health.ts)).
- Claude Haiku 5.5 runs at its default temperature, because it rejects any other. The same input can give a different answer.

### What we haven't verified

- **Which model made a given call.** `/healthz` reports provider `anthropic` (checked 10:36 IST), and `render.yaml` sets `claude-haiku-5-5`, but the public record doesn't name the model for each call. Season 0's replay file will, after the close at 21:30 IST tonight. Until then the model behind any single call is UNVERIFIED.

### AI agents as readers

The read-only BotFolio MCP server lets any agent read a bot's record and re-check a trade against QIE's oracle ([mcp-demo.md](mcp-demo.md)). The server tells agents to treat bot names, reasons and roasts as data, never as instructions. For the walkthrough, a headless Claude Code agent (Opus 5.5) called `verify_trade` and reported that all 7 prices matched their oracle rounds (Sat 28 Nov, 01:01 IST). Other MCP clients are UNVERIFIED.

## AI in building it

### Claude Code

189 of the 430 non-merge commits on `main` (44 %) carry a `Co-Authored-By: Claude Opus 5.5` trailer. The trailer marks a commit that Claude Code helped write, and the teammate named as author committed it under their own name. It doesn't say how much of the diff the model typed. A commit without the trailer may still have had AI help we didn't record, so the trailer count is a floor, not a split between human and AI work.

SPEC.md planned all four workstreams to be built with Claude Code from Day 1: "the team builds with Claude Code" (SPEC.md, line 7), and §16.3 has a starting prompt for each workstream. Gokul's 224 commits carry no trailer, so how much of them Claude Code wrote is UNVERIFIED (ask Gokul).

`git shortlog -sn --no-merges 723b0fd`, with the trailer count for each author:

| Author (git name) | Commits | With the trailer |
|---|---|---|
| Gokul | 224 | 0 (AI help UNVERIFIED) |
| DiveshK007 | 131 | 123 |
| Dijo-404 | 65 | 65 |
| dependabot[bot] | 7 | 0 |
| Cursor Agent | 2 | 0 |
| Divesh Kumar S | 1 | 1 |
| **Total** | **430** | **189** |

"Divesh Kumar S" is Divesh's second git identity: his commit `5ac9411` came in his PR [#342](https://github.com/DiveshK007/BotFolio/pull/342). The 2 Cursor Agent commits list him as co-author.

The daily split roughly follows the workstream plan in CLAUDE.md. Gokul built the code workstreams alone from Sat 21 to Tue 24 Nov (the plan said through Sun 22), and Divesh and Dijo joined after that.

| Day (IST) | Commits | With the trailer | Who |
|---|---|---|---|
| Fri 20 Nov | 8 | 7 | Divesh 7, Cursor's agent 1 |
| Sat 21 – Tue 24 Nov | 225 | 0 | Gokul 220, dependabot 4, Cursor's agent 1 |
| Wed 25 Nov | 77 | 66 | Dijo 65, Divesh 9, dependabot 3 |
| Thu 26 Nov | 54 | 54 | Divesh 54 |
| Fri 27 Nov | 62 | 62 | Divesh 62 |
| Sat 28 Nov, to 00:47 | 4 | 0 | Gokul 4 |

By area (one commit can touch several):

| Area | Commits | With the trailer |
|---|---|---|
| `packages/contracts` | 57 | 11 |
| `apps/worker` | 189 | 68 |
| `apps/web` | 110 | 69 |
| `packages/llm` | 14 | 2 |
| `docs/` | 69 | 54 |
| `SPEC.md` | 13 | 11 |

### Other AI tools

- **This README, JUDGE.md and this page** were drafted by Claude Code (Opus 5.5) on Sat 28 Nov, from sources checked that day. The README images in [`docs/media/readme/`](media/readme) are HTML pages Claude Code wrote and rendered, plus GIFs cut from screen recordings of the live site and the explorer; no image-generation model was used. This departs from SPEC §16.4, where each owner writes the README section for their workstream in their own words.
- **Claude Design** made the website's design export: a prototype, a page spec and screenshots ([`website-export/`](../website-export), added Fri 20 Nov in commit `bcb38fd`). All its data is EXAMPLE except the chain facts. The app's design variables and fonts are copied from it ([`apps/web/styles/`](../apps/web/styles)). [`HANDOFF_PROMPT.md`](../website-export/HANDOFF_PROMPT.md) is the prompt written for Claude Code to build it into `apps/web`; whether and how it was used is UNVERIFIED.
- **Cursor's agent** wrote 2 commits that align the spec and docs with the Nov 20 review fixes (`d92f2cf`, `7d638f9`).
- **GitHub Copilot's PR reviewer** left comments on 149 of the 156 merged PRs.

### The demo videos

- **Voice:** in the walkthrough published on Sat 28 Nov, every spoken line is ElevenLabs text-to-speech, in the "Brooklyn Narrator" voice. A builder's voice for the agent-loop lines, and the team's selfies, replace parts of it only if those takes arrive ([decisions.md](decisions.md), Nov 28).
- **Editing:** Claude Code assembled each cut in code (HTML compositions rendered to video). It ran independent review passes and checked every spoken word against the script.
- **Footage:** about 131 s of the walkthrough's 178.5 s is badged LIVE: screen recordings of the live site and the QIE explorer, a real Claude Code session, and output from real terminal runs re-set in the video's type (badged RE-SET). Another 18.5 s is badged ANIMATED: a film rebuilt from bot 4's 09:00 call, whose e.g. rows are illustrations. About 8 s is badged EXAMPLE: the landing page's walkthrough with sample data. The rest is chapter cards and the end card. (Timed from the published file, 4 frames a second.) The animated film, the chapter cards and the end card are HTML that Claude Code wrote; no image or video generation model was used. Every number on screen was checked against one fact file that names a source for every value (137 values: 116 LIVE, 7 EXAMPLE, 14 UNVERIFIED).
- **Music:** an original bed that Claude Code composed in code (a Python script, no AI music model), from CC0 FreePats samples and the "MuldjordKit" drums by Lars Muldjord (CC BY 4.0).

## What the team did

- **Product and architecture decisions.** Every real decision is in [decisions.md](decisions.md), with who made it. Of its 41 entries at `723b0fd`:
  - 11 are Gokul's, 11 Divesh's and 5 the whole team's;
  - 11 are "Divesh + Claude" and 1 is "Dijo + Claude";
  - 2 were written up by Claude for a teammate's review.

  For example:
  - **The team** chose the product. It pinned OpenZeppelin 5.0.2 and solc 0.8.24 for Shanghai, because QIE has no Cancun. It chose OpenZeppelin's ERC-2771 forwarder, deployed unchanged, with our own relayer, because QIE has no paymaster.
  - **Divesh** set per-action order ids, the runner-signed Daily Call view and contract-derived challenge codes, and dropped testnet staging for a local mainnet fork.
  - **Gokul** settled the trust-score details the spec left open, built the MCP server as a small JSON-RPC handler with no SDK, and chose the MIT licence.
  - **Divesh, working with Claude**, ran the mainnet deploy, re-seeded the season calendar and moved the LLM to Claude Haiku 5.5 to fit a $5 credit.
- **Workstreams.** [CLAUDE.md](../CLAUDE.md) gives each folder an owner.
  - **Gokul** built all three code workstreams (contracts, runner and app), Sat 21 – Tue 24 Nov: 220 of his 224 commits are from those days.
  - **Divesh** owns growth and the QIE ecosystem: registration, wallets, QIE checks and the launch, including the mainnet deploy.
  - **Dijo** joined on Wed 25 Nov and built the share cards, the public API, `/stats`, the contract security pass, the stale-oracle tests and the runbooks.
- **Reviews.** Most of the review that GitHub records is automated:
  - Copilot's reviewer commented on 149 of the 156 merged PRs.
  - A teammate commented on 5 PRs they didn't write: 4 dependabot bumps (#217, #218, #271, #272) and 1 teammate's PR (#184).
  - 8 PRs were merged by someone other than their author, and 7 of those were dependabot's.
  - CI runs on every PR that touches its folder: typecheck, tests and build for the web app (plus lint) and the worker; `forge` tests on a mainnet fork, a deploy dry run and Slither for the contracts; and `pnpm audit`.
  - The spec questions before the mainnet deploy were settled in issue [#219](https://github.com/DiveshK007/BotFolio/issues/219) and approved there ([decisions.md](decisions.md), Nov 26).
- **Mainnet deploy and keys.** On Thu 26 Nov, 27 txs from the deployer `0x8a3d…4307` (blocks 12186870–12186896) deployed all 7 contracts. All 7 are source-verified, and `check-mainnet.sh` passed 28 of 28 checks ([decisions.md](decisions.md), Nov 26). Four wallets split the roles: an admin cold key, plus hot keys for the runner, the committer and the relayer (which holds no role). The admin key stays offline and never goes on Render or Vercel ([security-review.md](security-review.md)). The rule for every session, human or AI: secrets never go in code, in `NEXT_PUBLIC_*` variables or into a chat (CLAUDE.md).
- **Operations.** An alert monitor watches for low wallet balances, the LLM budget and failed jobs, and a 5-minute uptime ping keeps the worker awake (an outside UptimeRobot check, per [decisions.md](decisions.md), Nov 26; UNVERIFIED). The [runbook](runbook.md) covers restarts, stale oracles, LLM or RPC outages, wallet top-ups and key rotation.

## How to check

From a full clone:

```bash
git clone https://github.com/DiveshK007/BotFolio && cd BotFolio
# Non-merge commits: 430. With the Claude trailer: 189.
git rev-list --no-merges --count 723b0fd
git log --no-merges -i --grep='^co-authored-by: *claude' --format=%h 723b0fd | wc -l
# Commits per author, and which commits carry the trailer
git shortlog -sn --no-merges 723b0fd
git log --no-merges -i --grep='^co-authored-by: *claude' --format='%h %an %s' 723b0fd
# Merged PRs up to 723b0fd that have a review, and who reviewed: 149 of 156, all Copilot
gh pr list --repo DiveshK007/BotFolio --state merged --limit 400 \
  --search "merged:<=2026-11-27T19:17:37Z" --json reviews \
  --jq '"\(map(select(.reviews != [])) | length) of \(length); by \([.[].reviews[].author.login] | unique)"'
```

Swap `723b0fd` for `origin/main` (and drop the `--search`) for today's counts; they only grow. In [decisions.md](decisions.md), the last field of each line says who decided.

## Ownership

[CLAUDE.md](../CLAUDE.md) sets the rule: "Whoever commits code must be able to explain it to a judge." Claude Code drafts, and the person who commits owns the result and answers for it. Each owner rehearses the four questions in [judge-qa.md](judge-qa.md) in their own words, with file:line pointers into the code:
- who pays gas;
- what happens when a price is stale;
- how a big move is stopped from executing twice;
- why we use a chain.

You can ask Gokul about the contracts, the gate and the runner; Divesh about the mainnet deploy, the QIE integration and the launch; and Dijo about the cards, the public API, `/stats` and the security pass.
