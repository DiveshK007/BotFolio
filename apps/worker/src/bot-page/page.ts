import { ASSETS, type AssetId } from "@botfolio/shared";
import { botRecord, type BotRecord } from "../mcp/record";
import type { Queryable } from "../scheduler/db";

export const PAGE_DECISIONS = 50;

const DIGITS = /^\d{1,78}$/;

export interface Holding {
  asset: AssetId;
  units_e18: string;
  value_e8: string;
}

export interface BotPage extends BotRecord {
  /** PaperLedger.START_CASH_E8, for the $ display rule (SPEC §3). */
  start_cash_e8: string;
  /** The latest slot mark, with the oracle reads it was priced at (SPEC §5.6). Null before the first mark. */
  mark: {
    slot_time: string;
    cash_e8: string;
    value_e8: string;
    holdings: Holding[];
    prices: { asset: AssetId; round_id: string; answer_e8: string; updated_at: string; fresh: boolean }[];
  } | null;
  /** The latest calls, newest first, held and skipped ones included. Older ones are in the season's replay file. */
  decisions: {
    id: string;
    version: number;
    slot_time: string;
    slot_kind: string;
    status: string;
    reason: string | null;
    reason_tag: string | null;
    roast: string | null;
    /** A mined trade on QIE came from this call. `executed` alone only means the gate accepted an order. */
    traded: boolean;
    /** Assets the gate held because QIE's price was too old, with its age at the call in seconds (SPEC §5 rule 4). */
    stale: StalePrice[];
  }[];
}

export interface StalePrice {
  asset: AssetId;
  age_s: number;
}

const isAsset = (a: string): a is AssetId => ASSETS.some((x) => x.id === a);

/** From a public `decisions.gate_result`: the gate's stale drops, aged by the round it saw against its own clock. */
export function staleAtCall(gate: unknown): StalePrice[] {
  const g = (gate ?? {}) as {
    events?: { kind?: string; reason?: string; asset?: string }[];
    replay?: { input?: { nowSeconds?: number }; rounds?: { asset?: string; updatedAt?: number }[] };
  };
  const now = g.replay?.input?.nowSeconds;
  if (!Array.isArray(g.events) || typeof now !== "number") return [];
  const out: StalePrice[] = [];
  for (const e of g.events) {
    if (e.kind !== "drop" || e.reason !== "stale" || typeof e.asset !== "string" || !isAsset(e.asset) || out.some((x) => x.asset === e.asset)) continue;
    const round = g.replay?.rounds?.find((r) => r.asset === e.asset);
    if (typeof round?.updatedAt === "number") out.push({ asset: e.asset, age_s: Math.max(0, now - round.updatedAt) });
  }
  return out;
}

/** `portfolio_marks.holdings` is {"GOLD": {"units_e18": "…", "value_e8": "…"}}; anything else is left out. */
export function parseHoldings(raw: unknown): Holding[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
  const out: Holding[] = [];
  for (const a of ASSETS) {
    if (!Object.hasOwn(raw, a.id)) continue;
    const h = (raw as Record<string, unknown>)[a.id] as { units_e18?: unknown; value_e8?: unknown } | undefined;
    if (typeof h !== "object" || h === null) continue;
    const units = String(h.units_e18 ?? "");
    const value = String(h.value_e8 ?? "");
    if (!DIGITS.test(units) || !DIGITS.test(value) || units === "0".repeat(units.length)) continue;
    out.push({ asset: a.id, units_e18: units, value_e8: value });
  }
  return out;
}

/**
 * Everything the public bot page (S4, #78) shows: the `get_bot_record` payload plus the latest mark with its
 * oracle reads and the latest decisions. Same public data as the `site_*` views; nothing secret.
 */
export async function botPage(db: Queryable, botId: bigint, startCashE8: () => Promise<bigint>): Promise<BotPage | null> {
  const record = await botRecord(db, botId);
  if (!record) return null;
  const id = botId.toString();

  const { rows: decisions } = await db.query<Omit<BotPage["decisions"][number], "slot_time" | "stale"> & { slot_time: Date; gate_result: unknown }>(
    `select d.id::text as id, d.version, s.slot_time, s.kind::text as slot_kind, d.status::text as status, d.reason, d.reason_tag, d.roast,
            exists (select 1 from trades t where t.decision_id = d.id and t.tx_hash is not null) as traded,
            jsonb_build_object('events', d.gate_result -> 'events', 'replay', jsonb_build_object(
              'input', jsonb_build_object('nowSeconds', d.gate_result #> '{replay,input,nowSeconds}'),
              'rounds', d.gate_result #> '{replay,rounds}')) as gate_result
     from decisions d join slots s on s.id = d.slot_id
     where d.bot_id = $1::bigint order by s.slot_time desc, d.created_at desc limit $2::int`,
    [id, PAGE_DECISIONS],
  );
  const { rows: marks } = await db.query<{ slot_id: string; slot_time: Date; cash_e8: string; value_e8: string; holdings: unknown }>(
    `select m.slot_id::text as slot_id, s.slot_time, m.cash_e8::text as cash_e8, m.value_e8::text as value_e8, m.holdings
     from portfolio_marks m join slots s on s.id = m.slot_id
     where m.bot_id = $1::bigint order by s.slot_time desc limit 1`,
    [id],
  );
  const m = marks[0];
  let mark: BotPage["mark"] = null;
  if (m) {
    const { rows: reads } = await db.query<{ asset: string; round_id: string; answer_e8: string; updated_at: Date; fresh: boolean }>(
      `select asset::text as asset, round_id::text as round_id, answer::text as answer_e8, updated_at, fresh
       from oracle_reads where slot_id = $1::bigint order by asset`,
      [m.slot_id],
    );
    mark = {
      slot_time: new Date(m.slot_time).toISOString(),
      cash_e8: m.cash_e8,
      value_e8: m.value_e8,
      holdings: parseHoldings(typeof m.holdings === "string" ? JSON.parse(m.holdings) : m.holdings),
      prices: reads
        .filter((r): r is typeof r & { asset: AssetId } => isAsset(r.asset))
        .map((r) => ({ ...r, updated_at: new Date(r.updated_at).toISOString() })),
    };
  }

  return {
    ...record,
    start_cash_e8: (await startCashE8()).toString(),
    mark,
    decisions: decisions.map(({ gate_result, ...d }) => ({ ...d, slot_time: new Date(d.slot_time).toISOString(), stale: staleAtCall(gate_result) })),
  };
}
