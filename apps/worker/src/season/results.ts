import type { Queryable } from "../scheduler/db";

export interface SeasonResult {
  botId: bigint;
  isHouse: boolean;
  startValueE8: bigint;
  endValueE8: bigint;
  returnBps: number;
  /** null when not eligible: < 3 executed trades or < 3 daily returns (SPEC §8). */
  sortino: number | null;
  maxDdBps: number;
  trades: number;
  /** 1–4 against the house bots; null for a house bot. */
  battleRank: number | null;
}

export interface MarkPoint {
  slotTime: Date;
  valueE8: bigint;
}

const SORTINO_MIN = 3;
const DOWNSIDE_FLOOR = 0.001;

/** Peak-to-trough, in bps of the peak. */
export function maxDrawdownBps(values: readonly bigint[]): number {
  let peak = 0n;
  let worst = 0n;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0n) {
      const dd = ((peak - v) * 10_000n) / peak;
      if (dd > worst) worst = dd;
    }
  }
  return Number(worst);
}

/** Returns of each 21:00 IST mark over the one before, the first over the start value. */
export function dailyReturns(start: bigint, marks: readonly MarkPoint[]): number[] {
  const closes = marks.filter((m) => {
    const ist = new Date(m.slotTime.getTime() + 19_800_000);
    return ist.getUTCHours() === 21 && ist.getUTCMinutes() === 0;
  });
  const returns: number[] = [];
  let before = start;
  for (const { valueE8 } of closes) {
    if (before > 0n) returns.push(Number(((valueE8 - before) * 1_000_000_000n) / before) / 1e9);
    before = valueE8;
  }
  return returns;
}

/** SPEC §8 "Best Risk-Adjusted (Sortino, simple)". */
export function sortino(returns: readonly number[], trades: number): number | null {
  if (returns.length < SORTINO_MIN || trades < SORTINO_MIN) return null;
  const mean = returns.reduce((a, r) => a + r, 0) / returns.length;
  const downside = Math.max(DOWNSIDE_FLOOR, Math.sqrt(returns.reduce((a, r) => a + Math.min(r, 0) ** 2, 0) / returns.length));
  return Math.round((mean / downside) * 1e6) / 1e6;
}

/** Top Returns order (SPEC §8): higher return first, then lower drawdown. */
const byReturn = (a: SeasonResult, b: SeasonResult) => b.returnBps - a.returnBps || a.maxDdBps - b.maxDdBps;

/**
 * Each bot's season (SPEC §2.3, §8). The start is the bot's last mark before the season opened, or the start
 * cash if it joined during the season. The end is its last mark of the season, which is the 21:00 slot's.
 */
export async function computeSeasonResults(db: Queryable, season: number, startCashE8: bigint): Promise<SeasonResult[]> {
  const { rows: bots } = await db.query<{ id: string; is_house: boolean; before: string | null; trades: number }>(
    `select b.id::text as id, b.is_house,
            (select m.value_e8::text from portfolio_marks m join slots s on s.id = m.slot_id
             where m.bot_id = b.id and s.slot_time < n.starts_at order by s.slot_time desc limit 1) as before,
            (select count(*)::int from trades t join decisions d on d.id = t.decision_id join slots s on s.id = d.slot_id
             where t.bot_id = b.id and t.tx_hash is not null and s.season_id = n.id) as trades
     from bots b, seasons n
     where n.id = $1::int
       and exists (select 1 from portfolio_marks m join slots s on s.id = m.slot_id where m.bot_id = b.id and s.season_id = n.id)
     order by b.id`,
    [season],
  );
  const { rows: marks } = await db.query<{ bot_id: string; slot_time: Date; value_e8: string }>(
    `select m.bot_id::text as bot_id, s.slot_time, m.value_e8::text as value_e8
     from portfolio_marks m join slots s on s.id = m.slot_id
     where s.season_id = $1::int order by s.slot_time, s.id`,
    [season],
  );

  const results: SeasonResult[] = bots.map((bot) => {
    const points: MarkPoint[] = marks
      .filter((m) => m.bot_id === bot.id)
      .map((m) => ({ slotTime: new Date(m.slot_time), valueE8: BigInt(m.value_e8) }));
    const start = bot.before === null ? startCashE8 : BigInt(bot.before);
    const end = points.at(-1)!.valueE8;
    return {
      botId: BigInt(bot.id),
      isHouse: bot.is_house,
      startValueE8: start,
      endValueE8: end,
      returnBps: Number(((end - start) * 10_000n) / start),
      sortino: sortino(dailyReturns(start, points), bot.trades),
      maxDdBps: maxDrawdownBps([start, ...points.map((p) => p.valueE8)]),
      trades: bot.trades,
      battleRank: null,
    };
  });

  // The battle: each raised bot against the house bots (SPEC §8).
  const house = results.filter((r) => r.isHouse);
  for (const r of results) {
    if (!r.isHouse) r.battleRank = [r, ...house].sort(byReturn).indexOf(r) + 1;
  }
  return results;
}

export async function saveSeasonResults(db: Queryable, season: number, results: readonly SeasonResult[]): Promise<void> {
  for (const r of results) {
    await db.query(
      `insert into season_results
         (season_id, bot_id, start_value_e8, end_value_e8, return_bps, sortino, max_dd_bps, trades, battle_rank)
       values ($1::int, $2::bigint, $3::numeric, $4::numeric, $5::int, $6::numeric, $7::int, $8::int, $9::int)
       on conflict (season_id, bot_id) do update set
         start_value_e8 = excluded.start_value_e8, end_value_e8 = excluded.end_value_e8, return_bps = excluded.return_bps,
         sortino = excluded.sortino, max_dd_bps = excluded.max_dd_bps, trades = excluded.trades,
         battle_rank = excluded.battle_rank`,
      [season, r.botId.toString(), r.startValueE8.toString(), r.endValueE8.toString(), r.returnBps, r.sortino, r.maxDdBps, r.trades, r.battleRank],
    );
  }
}
