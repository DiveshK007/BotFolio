/** Test data: one bot page as the worker sends it. */
import type { BotPage } from "./bot-record";

const TX = `0x${"ab".repeat(32)}`;

export const samplePage = (): BotPage => ({
  bot: {
    id: "7",
    name: "AlphaWolf",
    emoji: "🐺",
    persona: "Buys dips.",
    owner_wallet: `0x${"1".repeat(40)}`,
    owner_qie_name: null,
    is_house: false,
    status: "active",
    created_at: "2026-11-24T00:00:00.000Z",
    created_tx: TX,
  },
  versions: [{ version: 1, source: "create", config_hash: `0x${"22".repeat(32)}`, committed_tx: TX, approved_at: null, max_per_coin_bps: 2500, max_trades_per_day: 4 }],
  trades: [
    {
      tx_hash: TX, block_number: "9", asset: "BTC", side: "BUY", cash_e8: "10000000000", units_e18: "1500000000000000", price_e8: "6392295000000",
      round_id: "50887", reason: "A little BTC on strength.", decision_id: "d1", slot_time: "2026-11-26T03:30:00.000Z",
      oracle_updated_at: "2026-11-26T03:28:00.000Z", owner_signed: false,
    },
  ],
  seasons: [{ season: 1, return_bps: 1000, max_dd_bps: 250, sortino: null, trades: 1, battle_rank: 1 }],
  trust: {
    season: 1, rulesVersion: "trust-v1-sprint", fRules: 250, fDrawdown: 229, fConsistency: 125, fExplains: 250, total: 854, provisional: true,
    root: `0x${"33".repeat(32)}`, committedRoot: null, scoresTx: null,
  },
  start_cash_e8: "100000000000",
  mark: {
    slot_time: "2026-11-26T07:30:00.000Z",
    cash_e8: "90000000000",
    value_e8: "101000000000",
    holdings: [{ asset: "BTC", units_e18: "1500000000000000", value_e8: "11000000000" }],
    prices: [{ asset: "BTC", round_id: "50888", answer_e8: "6392295000000", updated_at: "2026-11-26T07:29:00.000Z", fresh: true }],
  },
  decisions: [{ id: "d1", version: 1, slot_time: "2026-11-26T03:30:00.000Z", slot_kind: "scheduled", status: "executed", reason: "A little BTC on strength.", reason_tag: "momentum", roast: null }],
});
