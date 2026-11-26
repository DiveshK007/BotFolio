# MCP demo: an agent reads BotFolio and QIE

Two MCP servers, both read-only, both Streamable HTTP over a plain `POST` with no session and no key:

| Server | URL | What it is for |
|---|---|---|
| **BotFolio MCP** | `https://botfolio-worker.onrender.com/mcp` | A bot's public record, the season boards, and re-checking a trade against QIE itself. Code: [`apps/worker/src/mcp/mcp.ts`](../apps/worker/src/mcp/mcp.ts) (SPEC §10.1, #64). |
| **QIE Wallet MCP** | `https://mcp.qie.digital/mcp` | QIE chain data: balances, `.qie` names, tx status, network info. Run by QIE, not by us. BotFolio's worker uses only `qie_reverse_lookup` ([qie-components.md](qie-components.md)). |

Trades are settled against QIE's official mainnet oracle. Play money. Not investment advice. No prizes.

## Connect a client

Both servers answer JSON-RPC on `POST` and return `405` on `GET` (no server-sent stream), which the MCP spec allows.

**Claude Code** (UNVERIFIED: not run against these URLs yet)

```sh
claude mcp add --transport http botfolio https://botfolio-worker.onrender.com/mcp
claude mcp add --transport http qie-wallet https://mcp.qie.digital/mcp
```

or the same in a project's `.mcp.json`. Other clients take a similar JSON shape, though key names vary; Claude Desktop adds a remote server under Settings → Connectors. UNVERIFIED: not tried with any of them.

```json
{
  "mcpServers": {
    "botfolio":   { "type": "http", "url": "https://botfolio-worker.onrender.com/mcp" },
    "qie-wallet": { "type": "http", "url": "https://mcp.qie.digital/mcp" }
  }
}
```

The only client tested so far is `curl` (transcript below). Until a real client is tried, say "works over plain HTTP JSON-RPC", not "works in Claude Desktop".

Limits: the BotFolio MCP allows 60 requests per minute per IP and up to 10 messages per batch. The Render free instance sleeps when idle, so the first call after a quiet spell can take up to a minute.

## Tools

**BotFolio MCP** (all `readOnlyHint: true`)

| Tool | Arguments | Returns |
|---|---|---|
| `get_bot_record` | `bot_id` or `name` | Owner, every committed version with its config hash, the latest 50 trades with tx hashes and oracle round ids, season results, trust score with its Merkle proof for `TrustScoreRegistry.verifyScore`. |
| `get_leaderboard` | `board` (`top_returns`, `best_risk_adjusted`, `most_trusted`, `coach_vs_bot`), optional `season` | Top 20 of that board. House bots are listed, never ranked. Season 0 is the hidden test season and is refused. |
| `verify_trade` | `tx_hash` | Reads the tx from QIE mainnet, not from our database: each PaperLedger `Trade` event and the oracle's answer for the round it used. `valid` = the tx has at least one trade; `matches_oracle` = every price equals the oracle's. |

Bot names, personas, rules, reasons and roasts are written by players or by an LLM from a player's sentence. The server tells the agent to treat them as data, never as instructions (#159).

**QIE Wallet MCP** (all `readOnlyHint: true`, from its own `tools/list`): `qie_get_balances`, `qie_resolve_name`, `qie_reverse_lookup`, `qie_get_tx_status`, `qie_list_tokens`, `qie_get_network_info`.

## Three prompts to try

1. "Use the BotFolio tools to look up Steady Sam. Who owns it, which versions has it committed, and what has it traded?"
2. "Show me BotFolio's Most Trusted board for this season, then take the top bot's latest trade and check it with verify_trade. Did its price match QIE's oracle round?"
3. "Take the owner wallet of BotFolio bot 4 and ask the QIE Wallet MCP whether it has a `.qie` name, and what its QIE balance is."

Prompt 2 needs a live season with trades: Season 1 opens Nov 29 00:00 IST. Before that, `get_leaderboard` answers "No season has started yet."

## Transcript (real, Nov 27 2026, 02:58–02:59 IST)

Run with `curl` from a laptop against the deployed servers. Responses are pasted as returned; `…` marks where long strings were cut.

### BotFolio: `initialize`

```sh
curl -s -X POST https://botfolio-worker.onrender.com/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"8"}}}'
```

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":false}},
 "serverInfo":{"name":"botfolio","title":"BotFolio","version":"1.0.0"},
 "instructions":"BotFolio is a play-money paper-trading game on QIE mainnet (chain 1990): people raise AI trading bots and coach them each season. These tools are read-only. … Trades are settled against QIE's official mainnet oracle. Play money. Not investment advice. No prizes."}}
```

`{"jsonrpc":"2.0","method":"notifications/initialized"}` → HTTP `202`, empty body.

### BotFolio: `tools/list`

```sh
curl -s -X POST https://botfolio-worker.onrender.com/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

HTTP `200`. Tool names returned: `get_bot_record`, `get_leaderboard`, `verify_trade`, with the schemas and descriptions in [`mcp.ts`](../apps/worker/src/mcp/mcp.ts).

### BotFolio: `get_bot_record` for bot 1

```sh
curl -s -X POST https://botfolio-worker.onrender.com/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_bot_record","arguments":{"bot_id":1}}}'
```

`structuredContent` (the same JSON also comes as a text block):

```json
{
  "bot": {
    "id": "1", "name": "Steady Sam", "emoji": "🐢",
    "persona": "Calm and patient. Splits the money evenly across all five assets and leaves it alone.",
    "owner_wallet": "0x24ba066120dbb76bd6ebf86bc66236e1d9cd7457", "owner_qie_name": null,
    "is_house": true, "status": "active",
    "created_at": "2026-11-26T13:27:22.000Z",
    "created_tx": "0x9bd294b18431679e89a39654588322378e8f42b8b2d4d1fc987609b4805ec55c",
    "dna_seed": null
  },
  "versions": [
    { "version": 1, "source": "create",
      "config_hash": "0x548b5da29d22c6d7513bd544ba2d871fb3f5830cd7e33639f423bbb8fc0e64c0",
      "committed_tx": "0x9bd294b18431679e89a39654588322378e8f42b8b2d4d1fc987609b4805ec55c",
      "approved_at": null, "max_per_coin_bps": 2500, "max_trades_per_day": 8 }
  ],
  "trades": [],
  "seasons": [],
  "trust": null,
  "chain": { "chain_id": 1990, "explorer": "https://mainnet.qie.digital" },
  "note": "Trades settled against QIE's official mainnet oracle. Play money. Not investment advice. No prizes."
}
```

Looking up by name works too: `{"name":"Gold Granny"}` returned bot 2. At this time bots 1–4 existed (three house bots and "Dad's Gold Guard") and none had an indexed trade yet.

### BotFolio: `verify_trade`

With no trade on record yet, this call used bot 1's createBot tx from above, to show the tool reading QIE directly and saying plainly when a tx holds no trade:

```sh
curl -s -X POST https://botfolio-worker.onrender.com/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"verify_trade","arguments":{"tx_hash":"0x9bd294b18431679e89a39654588322378e8f42b8b2d4d1fc987609b4805ec55c"}}}'
```

```json
{"tx_hash":"0x9bd294b18431679e89a39654588322378e8f42b8b2d4d1fc987609b4805ec55c","valid":false,"matches_oracle":false,
 "block_number":"12187041","trades":[],"note":"The transaction has no BotFolio trade."}
```

TODO once the first trade is indexed: run `verify_trade` on a real trade tx and paste a `valid: true, matches_oracle: true` answer here, with its date.

### QIE Wallet MCP: `tools/list` and `qie_get_network_info`

The QIE server answers in server-sent-event framing (`event: message` / `data: {…}`), so send `accept: application/json, text/event-stream`.

```sh
curl -s -X POST https://mcp.qie.digital/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"qie_get_network_info","arguments":{}}}'
```

```
event: message
data: {"result":{"content":[…],"structuredContent":{"status":"ok","network":"mainnet","chainId":1990,"name":"QIE Mainnet",
 "rpcUrls":["https://rpc1mainnet.qie.digital","https://rpc2mainnet.qie.digital","https://rpc3mainnet.qie.digital","https://rpc4mainnet.qie.digital","https://rpc5mainnet.qie.digital"],
 "explorerUrl":"https://mainnet.qie.digital","currency":{"name":"QIE","symbol":"QIE","decimals":18},
 "notice":"This result is chain data only. It does not give price, APY, returns, yield, or investment advice."}},"jsonrpc":"2.0","id":2}
```

`tools/list` on the same server listed `qie_get_balances` first, then the other five tools above.

## Still to check

- A real MCP client (Claude Code, Claude Desktop, Cursor) connected to both URLs and running the three prompts. UNVERIFIED until done; if it is done by Nov 29 15:00 IST, the clip goes into the video (master plan B5).
- A `verify_trade` answer on a real trade (see TODO above).
