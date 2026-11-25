import type { Queryable } from "../scheduler/db";
import { scoreProof, type ScoreProof } from "../trust/scores";

export const RECORD_TRADES = 50;

export interface BotRecord {
  bot: {
    id: string;
    name: string;
    emoji: string;
    persona: string;
    owner_wallet: string;
    owner_qie_name: string | null;
    is_house: boolean;
    status: string;
    created_at: string;
    created_tx: string | null;
  };
  /** Committed versions only, newest first: each brain the owner put on-chain, with its config hash. */
  versions: { version: number; source: string; config_hash: string; committed_tx: string | null; approved_at: string | null; max_per_coin_bps: number; max_trades_per_day: number }[];
  /**
   * The latest trades, newest first. Each can be checked with `verify_trade`. The runner sends them, except
   * `owner_signed` ones: an Approve Big Move the owner signed. `oracle_updated_at` is the round's updatedAt when the
   * slot's oracle read saw the same round, else null.
   */
  trades: {
    tx_hash: string; block_number: string; asset: string; side: string; cash_e8: string; units_e18: string; price_e8: string; round_id: string;
    reason: string | null; decision_id: string; slot_time: string; oracle_updated_at: string | null; owner_signed: boolean;
  }[];
  seasons: { season: number; return_bps: number; max_dd_bps: number; sortino: number | null; trades: number; battle_rank: number | null }[];
  /** The latest trust score, with the proof for `TrustScoreRegistry.verifyScore`. */
  trust: ScoreProof | null;
  chain: { chain_id: 1990; explorer: string };
  note: string;
}

/**
 * Everything public about one bot (SPEC §10, §10.1 `get_bot_record`), from the same data as the `site_*` views.
 * No correction notes, signatures or keys.
 */
export async function botRecord(db: Queryable, botId: bigint): Promise<BotRecord | null> {
  const id = botId.toString();
  const { rows: bots } = await db.query<{
    id: string; name: string; emoji: string; persona: string; owner: string; qie: string | null; is_house: boolean;
    status: string; created_at: Date; created_tx: string | null;
  }>(
    `select b.id::text as id, b.name, b.emoji, b.persona_text as persona, b.owner_wallet as owner, q.qie_name as qie,
            b.is_house, b.status::text as status, b.created_at, b.created_tx
     from bots b left join qie_names q on q.wallet_address = b.owner_wallet where b.id = $1::bigint`,
    [id],
  );
  const b = bots[0];
  if (!b) return null;

  const { rows: versions } = await db.query<BotRecord["versions"][number] & { approved_at: Date | null }>(
    `select version, source::text as source, '0x' || encode(config_hash, 'hex') as config_hash, committed_tx, approved_at,
            max_per_coin_bps, max_trades_per_day
     from bot_versions where bot_id = $1::bigint and (committed_tx is not null or source = 'create') order by version desc`,
    [id],
  );
  const { rows: trades } = await db.query<Omit<BotRecord["trades"][number], "slot_time" | "oracle_updated_at"> & { slot_time: Date; oracle_updated_at: Date | null }>(
    `select t.tx_hash, t.block_number::text as block_number, t.asset::text as asset, t.side::text as side,
            t.cash_e8::text as cash_e8, t.units_e18::text as units_e18, t.price_e8::text as price_e8,
            t.round_id::text as round_id, d.reason, d.id::text as decision_id, s.slot_time, r.updated_at as oracle_updated_at,
            exists (select 1 from big_moves m where m.user_tx = t.tx_hash) as owner_signed
     from trades t join decisions d on d.id = t.decision_id join slots s on s.id = d.slot_id
     left join oracle_reads r on r.slot_id = d.slot_id and r.asset = t.asset and r.round_id = t.round_id
     where t.bot_id = $1::bigint and t.tx_hash is not null
     order by t.block_number desc, t.log_index desc limit $2::int`,
    [id, RECORD_TRADES],
  );
  const { rows: seasons } = await db.query<{ season: number; return_bps: number; max_dd_bps: number; sortino: string | null; trades: number; battle_rank: number | null }>(
    `select season_id as season, return_bps, max_dd_bps, sortino::text as sortino, trades, battle_rank
     from season_results where bot_id = $1::bigint order by season_id desc`,
    [id],
  );
  const { rows: scored } = await db.query<{ season: number }>(
    "select max(season_id) as season from trust_scores where bot_id = $1::bigint",
    [id],
  );
  const trustSeason = scored[0]?.season;

  return {
    bot: {
      id: b.id,
      name: b.name,
      emoji: b.emoji,
      persona: b.persona,
      owner_wallet: b.owner,
      owner_qie_name: b.qie,
      is_house: b.is_house,
      status: b.status,
      created_at: new Date(b.created_at).toISOString(),
      created_tx: b.created_tx,
    },
    versions: versions.map((v) => ({ ...v, approved_at: v.approved_at ? new Date(v.approved_at).toISOString() : null })),
    trades: trades.map((t) => ({
      ...t,
      slot_time: new Date(t.slot_time).toISOString(),
      oracle_updated_at: t.oracle_updated_at ? new Date(t.oracle_updated_at).toISOString() : null,
    })),
    seasons: seasons.map((s) => ({ ...s, sortino: s.sortino === null ? null : Number(s.sortino) })),
    trust: trustSeason === null || trustSeason === undefined ? null : await scoreProof(db, trustSeason, botId),
    chain: { chain_id: 1990, explorer: "https://mainnet.qie.digital" },
    note: "Trades settled against QIE's official mainnet oracle. Play money. Not investment advice. No prizes.",
  };
}

/** Bots whose name matches, case-insensitive, for an agent that only knows the name. */
export async function findBots(db: Queryable, name: string): Promise<{ id: string; name: string; emoji: string; is_house: boolean }[]> {
  const { rows } = await db.query<{ id: string; name: string; emoji: string; is_house: boolean }>(
    "select id::text as id, name, emoji, is_house from bots where lower(name) = lower($1::text) order by id limit 10",
    [name],
  );
  return rows;
}
