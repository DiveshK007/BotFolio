# Public API (WS D)

Read-only JSON on the web app (Vercel). No sign-in, no keys, CORS open (`access-control-allow-origin: *`).
Play money. Not investment advice. No prizes.

## `GET /api/v1/bots/:id/record`

A bot's public record (SPEC §10). The body is the same payload as the MCP tool `get_bot_record` (§10.1), cut from
the worker's `GET /bot-page` answer (`apps/worker/src/mcp/record.ts` is the one query behind both). Fields are
copied by name in `apps/web/lib/public-record.ts`, so nothing new reaches this API without a change there.

`:id` is the on-chain `botId` (a positive integer).

### 200

```jsonc
{
  "bot": {
    "id": "7", "name": "AlphaWolf", "emoji": "🐺",
    "persona": "Buys dips.",               // user/LLM text: render as text only, never HTML or a link (#159)
    "owner_wallet": "0x…", "owner_qie_name": null,
    "is_house": false, "status": "active",
    "created_at": "2026-11-24T00:00:00.000Z", "created_tx": "0x…"
  },
  "versions": [                             // committed versions, newest first
    { "version": 1, "source": "create", "config_hash": "0x…", "committed_tx": "0x…", "approved_at": null,
      "max_per_coin_bps": 2500, "max_trades_per_day": 4 }
  ],
  "trades": [                               // latest 50, newest first
    { "tx_hash": "0x…", "block_number": "9", "asset": "BTC", "side": "BUY",
      "cash_e8": "10000000000", "units_e18": "1500000000000000", "price_e8": "6392295000000",
      "round_id": "50887",                  // the QIE oracle round the contract priced it at
      "reason": "…",                        // user/LLM text, untrusted
      "decision_id": "…", "slot_time": "…", "oracle_updated_at": "…",
      "owner_signed": false }               // true = an Approve Big Move the owner signed; false = sent by the runner
  ],
  "seasons": [ { "season": 1, "return_bps": 1000, "max_dd_bps": 250, "sortino": null, "trades": 1, "battle_rank": 1 } ],
  "trust": {                                // latest score, or null
    "season": 1, "botId": "7", "rulesVersion": "trust-v1-sprint",
    "fRules": 250, "fDrawdown": 229, "fConsistency": 125, "fExplains": 250, "total": 854, "provisional": true,
    "leaf": "0x…", "proof": ["0x…"], "root": "0x…",   // Merkle proof for TrustScoreRegistry.verifyScore
    "committedRoot": null, "scoresTx": null           // null until the season's root is on-chain
  },
  "chain": { "chain_id": 1990, "explorer": "https://mainnet.qie.digital" },
  "note": "Trades settled against QIE's official mainnet oracle. Play money. Not investment advice. No prizes."
}
```

Amounts are decimal strings: `*_e8` is play USDT with 8 decimals, `*_e18` is units with 18 decimals.
Runner trades are system transactions, not user activity; only `owner_signed` trades were signed by a user.
A trust score whose Merkle proof is missing or malformed is returned as `null` rather than unprovable.

Never in the body: correction notes, signatures (`runner_sig`), Privy ids, IPs, keys.

### Errors

`{ "error": { "code": "…", "message": "…" } }` with `cache-control: no-store`.

| Status | code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | `:id` isn't a positive integer |
| 404 | `NOT_FOUND` | no such bot |
| 503 | `NOT_LIVE` | the worker URL isn't set or the worker has bot pages off |
| 502 | `UPSTREAM_ERROR` | the worker failed or answered badly |

### Caching

200s: `cache-control: public, s-maxage=60, stale-while-revalidate=300`. The data changes once a slot.
