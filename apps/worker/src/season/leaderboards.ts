import { istDay } from "@botfolio/shared";
import type { Queryable } from "../scheduler/db";
import { computeSeasonResults } from "./results";

/*
 * The four season boards of SPEC §8, ranked with their eligibility and tiebreaks. A closed season reads what its
 * close stored (`season_results`, `trust_scores`); an open one is computed from the marks so far (the "live" view).
 * Every input is public (`site_*` views), so anyone can rebuild a board.
 */

export interface BoardEntry {
  botId: string;
  name: string;
  emoji: string;
  isHouse: boolean;
  ownerQieName: string | null;
  /** Place among human-raised bots. House bots are listed with a badge but never ranked, so #1 is always human. */
  rank: number | null;
}
export interface ReturnEntry extends BoardEntry {
  returnBps: number;
  maxDdBps: number;
}
export interface SortinoEntry extends BoardEntry {
  sortino: number;
  returnBps: number;
}
export interface TrustEntry extends BoardEntry {
  total: number;
}
export interface CallEntry extends BoardEntry {
  /** Daily Calls this season with a result (an equal price has none). */
  calls: number;
  /** Of those, how many the owner got right, and how many the bot did: "You 4 – AlphaWolf 3". */
  you: number;
  bot: number;
}

export interface Leaderboards {
  season: number;
  /** True until the season's results are stored: returns and Sortino from the marks so far. */
  live: boolean;
  /** Whose trust scores Most Trusted shows: this season's once scored, else the latest scored one before it. */
  trustSeason: number | null;
  topReturns: ReturnEntry[];
  bestRiskAdjusted: SortinoEntry[];
  mostTrusted: TrustEntry[];
  coachVsBot: CallEntry[];
}

/** Minimum Daily Calls with a result for Coach vs Bot (SPEC §8). */
export const MIN_CALLS = { sprint: 2, weekly: 4 } as const;

interface BotMeta {
  id: string;
  name: string;
  emoji: string;
  is_house: boolean;
  qie: string | null;
  created_at: Date;
}

interface Standing {
  botId: string;
  returnBps: number;
  maxDdBps: number;
  sortino: number | null;
}

/** Earlier creation first, then lower id: Most Trusted's tiebreak, and the last one on every board. */
const byAge = (meta: Map<string, BotMeta>) => (a: { botId: string }, b: { botId: string }) => {
  const x = meta.get(a.botId)!;
  const y = meta.get(b.botId)!;
  return new Date(x.created_at).getTime() - new Date(y.created_at).getTime() || Number(BigInt(x.id) - BigInt(y.id));
};

function ranked<T extends { botId: string }>(rows: T[], meta: Map<string, BotMeta>): (T & BoardEntry)[] {
  let place = 0;
  return rows.map((row) => {
    const m = meta.get(row.botId)!;
    return { ...row, name: m.name, emoji: m.emoji, isHouse: m.is_house, ownerQieName: m.qie, rank: m.is_house ? null : ++place };
  });
}

export async function leaderboards(db: Queryable, season: number, startCashE8: () => Promise<bigint>): Promise<Leaderboards | null> {
  const { rows: seasons } = await db.query<{ starts_at: Date; ends_at: Date; kind: "sprint" | "weekly"; status: string; stored: number }>(
    `select starts_at, ends_at, kind::text as kind, status::text as status,
            (select count(*)::int from season_results r where r.season_id = s.id) as stored
     from seasons s where id = $1::int`,
    [season],
  );
  const s = seasons[0];
  if (!s) return null;

  const live = s.status === "open" || s.stored === 0;
  let standings: Standing[];
  if (live) {
    standings = (await computeSeasonResults(db, season, await startCashE8())).map((r) => ({
      botId: r.botId.toString(),
      returnBps: r.returnBps,
      maxDdBps: r.maxDdBps,
      sortino: r.sortino,
    }));
  } else {
    const { rows } = await db.query<{ bot_id: string; return_bps: number; max_dd_bps: number; sortino: string | null }>(
      "select bot_id::text as bot_id, return_bps, max_dd_bps, sortino::text as sortino from season_results where season_id = $1::int",
      [season],
    );
    standings = rows.map((r) => ({ botId: r.bot_id, returnBps: r.return_bps, maxDdBps: r.max_dd_bps, sortino: r.sortino === null ? null : Number(r.sortino) }));
  }

  const { rows: trustRows } = await db.query<{ season: number | null }>(
    "select max(season_id) as season from trust_scores where season_id <= $1::int",
    [season],
  );
  const trustSeason = trustRows[0]?.season ?? null;
  const { rows: trust } = trustSeason === null
    ? { rows: [] as { bot_id: string; total: number }[] }
    : await db.query<{ bot_id: string; total: number }>(
        "select bot_id::text as bot_id, total from trust_scores where season_id = $1::int and not provisional",
        [trustSeason],
      );

  const firstDay = istDay(Math.floor(new Date(s.starts_at).getTime() / 1000));
  const lastDay = istDay(Math.floor(new Date(s.ends_at).getTime() / 1000));
  const { rows: calls } = await db.query<{ bot_id: string; calls: number; you: number; bot: number }>(
    `select bot_id::text as bot_id,
            count(*) filter (where user_correct is not null or bot_correct is not null)::int as calls,
            count(*) filter (where user_correct)::int as you,
            count(*) filter (where bot_correct)::int as bot
     from daily_calls where call_tx is not null and day between $1::int and $2::int group by bot_id`,
    [firstDay, lastDay],
  );

  const ids = [...new Set([...standings.map((r) => r.botId), ...trust.map((t) => t.bot_id), ...calls.map((c) => c.bot_id)])];
  const { rows: bots } = await db.query<BotMeta>(
    `select b.id::text as id, b.name, b.emoji, b.is_house, q.qie_name as qie, b.created_at
     from bots b left join qie_names q on q.wallet_address = b.owner_wallet where b.id = any($1::bigint[])`,
    [ids],
  );
  const meta = new Map(bots.map((b) => [b.id, b]));
  const age = byAge(meta);

  const topReturns = [...standings]
    .sort((a, b) => b.returnBps - a.returnBps || a.maxDdBps - b.maxDdBps || age(a, b))
    .map(({ botId, returnBps, maxDdBps }) => ({ botId, returnBps, maxDdBps }));
  // `sortino` is null unless the bot had ≥ 3 executed trades and ≥ 3 daily returns.
  const bestRiskAdjusted = standings
    .filter((r): r is Standing & { sortino: number } => r.sortino !== null)
    .sort((a, b) => b.sortino - a.sortino || b.returnBps - a.returnBps || age(a, b))
    .map(({ botId, sortino, returnBps }) => ({ botId, sortino, returnBps }));
  const mostTrusted = trust
    .map((t) => ({ botId: t.bot_id, total: t.total }))
    .sort((a, b) => b.total - a.total || age(a, b));
  const coachVsBot = calls
    .filter((c) => c.calls >= MIN_CALLS[s.kind] && !meta.get(c.bot_id)?.is_house)
    .map((c) => ({ botId: c.bot_id, calls: c.calls, you: c.you, bot: c.bot }))
    // Higher win rate first, compared exactly; then more right calls.
    .sort((a, b) => b.you * a.calls - a.you * b.calls || b.you - a.you || age(a, b));

  return {
    season,
    live,
    trustSeason,
    topReturns: ranked(topReturns, meta),
    bestRiskAdjusted: ranked(bestRiskAdjusted, meta),
    mostTrusted: ranked(mostTrusted, meta),
    coachVsBot: ranked(coachVsBot, meta),
  };
}
