/**
 * The public bot record (SPEC §10 public read layer, #106): the same payload as the worker's MCP `get_bot_record`
 * (apps/worker/src/mcp/record.ts), cut out of the worker's GET /bot-page answer so no new SQL backs it.
 * Every field is copied by name, so a field the worker adds later never leaks out of the public API unreviewed.
 * Documented in docs/public-api.md.
 */
import type { BotPage, BotTrade, BotVersion, BotSeason } from "./bot-record";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;

export interface PublicTrust {
  season: number;
  botId: string;
  rulesVersion: string;
  fRules: number;
  fDrawdown: number;
  fConsistency: number;
  fExplains: number;
  total: number;
  provisional: boolean;
  leaf: string;
  proof: string[];
  root: string;
  committedRoot: string | null;
  scoresTx: string | null;
}

export interface PublicRecord {
  bot: Pick<BotPage["bot"], "id" | "name" | "emoji" | "persona" | "owner_wallet" | "owner_qie_name" | "is_house" | "status" | "created_at" | "created_tx">;
  versions: BotVersion[];
  trades: BotTrade[];
  seasons: BotSeason[];
  trust: PublicTrust | null;
  chain: { chain_id: 1990; explorer: string };
  note: string;
}

const pick = <T extends object, K extends keyof T>(o: T, keys: readonly K[]): Pick<T, K> =>
  Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>;

/** A score without a well-formed Merkle proof can't be checked with TrustScoreRegistry.verifyScore, so it's left out. */
function trustOf(raw: unknown): PublicTrust | null {
  if (typeof raw !== "object" || raw === null) return null;
  const t = raw as Record<keyof PublicTrust, unknown>;
  if (typeof t.total !== "number" || typeof t.leaf !== "string" || !HEX32.test(t.leaf) || typeof t.root !== "string" || !HEX32.test(t.root)) return null;
  if (!Array.isArray(t.proof) || !t.proof.every((h) => typeof h === "string" && HEX32.test(h))) return null;
  return pick(t as unknown as PublicTrust, [
    "season", "botId", "rulesVersion", "fRules", "fDrawdown", "fConsistency", "fExplains", "total", "provisional",
    "leaf", "proof", "root", "committedRoot", "scoresTx",
  ]);
}

export function toPublicRecord(page: BotPage): PublicRecord {
  return {
    bot: pick(page.bot, ["id", "name", "emoji", "persona", "owner_wallet", "owner_qie_name", "is_house", "status", "created_at", "created_tx"]),
    versions: page.versions.map((v) =>
      pick(v, ["version", "source", "config_hash", "committed_tx", "approved_at", "max_per_coin_bps", "max_trades_per_day"]),
    ),
    trades: page.trades.map((t) =>
      pick(t, [
        "tx_hash", "block_number", "asset", "side", "cash_e8", "units_e18", "price_e8", "round_id", "reason", "decision_id",
        "slot_time", "oracle_updated_at", "owner_signed",
      ]),
    ),
    seasons: page.seasons.map((s) => pick(s, ["season", "return_bps", "max_dd_bps", "sortino", "trades", "battle_rank"])),
    trust: trustOf(page.trust),
    // Same constants the worker's botRecord puts in (the bot page parser doesn't keep them).
    chain: { chain_id: 1990, explorer: "https://mainnet.qie.digital" },
    note: "Trades settled against QIE's official mainnet oracle. Play money. Not investment advice. No prizes.",
  };
}
