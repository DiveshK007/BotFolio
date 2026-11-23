import type { AssetId } from "@botfolio/shared";
import { encodeAbiParameters, keccak256, parseAbiParameters, type Hex } from "viem";
import { canonicalJson } from "../canonical";
import { readExact } from "../decisions/json";
import type { Queryable } from "../scheduler/db";
import { dailyReturns, type MarkPoint } from "../season/results";
import { merkleProof, merkleRoot } from "../season/merkle";
import {
  fConsistency,
  fDrawdown,
  fExplains,
  fRules,
  reasonPasses,
  withTotal,
  type ExecutedDecision,
  type TrustFactors,
} from "./rules";

export interface TrustScore extends TrustFactors {
  botId: bigint;
  provisional: boolean;
  leaf: Hex;
}

const LEAF = parseAbiParameters("uint32, uint256, uint16, uint16, uint16, uint16, uint16");

/** `TrustScoreRegistry.leafHash`: keccak256(abi.encode(season, botId, fRules, fDrawdown, fConsistency, fExplains, total)). */
export function trustLeaf(season: number, botId: bigint, f: TrustFactors): Hex {
  return keccak256(encodeAbiParameters(LEAF, [season, botId, f.fRules, f.fDrawdown, f.fConsistency, f.fExplains, f.total]));
}

interface StoredEvent {
  actionIndex: number;
  countsForF1: boolean;
}
interface StoredGate {
  proposedActions?: number;
  events?: StoredEvent[];
  retries?: { result?: { events?: StoredEvent[] } }[];
}

/** Proposed actions and how many of them the gate clipped or dropped through the bot's own fault, retries included. */
function f1Counts(gate: StoredGate | null): { proposed: number; penalised: number } {
  if (!gate) return { proposed: 0, penalised: 0 };
  const events = [...(gate.events ?? []), ...(gate.retries ?? []).flatMap((r) => r.result?.events ?? [])];
  const penalised = new Set(events.filter((e) => e.countsForF1).map((e) => e.actionIndex));
  return { proposed: gate.proposedActions ?? 0, penalised: penalised.size };
}

/** 24 h changes from a logged input: `market[]` for raised bots, `chg24hPct` for house bots. */
function changesOf(input: unknown): Partial<Record<AssetId, number | null>> {
  if (typeof input !== "object" || input === null) return {};
  const { market, chg24hPct } = input as { market?: { asset: AssetId; chg_24h_pct: number | null }[]; chg24hPct?: Record<string, number | null> };
  if (Array.isArray(market)) return Object.fromEntries(market.map((m) => [m.asset, m.chg_24h_pct]));
  return chg24hPct ? (chg24hPct as Partial<Record<AssetId, number | null>>) : {};
}

/**
 * Every bot with a result this season, scored over its whole history up to the season's end (SPEC §7). Only data
 * from before `ends_at` counts, so running it again later gives the same scores. Run it after `saveSeasonResults`.
 */
export async function computeTrustScores(db: Queryable, season: number, startCashE8: bigint): Promise<TrustScore[]> {
  const { rows: seasons } = await db.query<{ ends_at: Date; min_trades: number }>(
    "select ends_at, provisional_min_trades as min_trades from seasons where id = $1::int",
    [season],
  );
  const s = seasons[0];
  if (!s) throw new Error(`no seasons row for ${season}`);

  const { rows: bots } = await db.query<{ id: string; trades: number; seasons: number }>(
    `select r.bot_id::text as id,
            (select count(*)::int from trades t join decisions d on d.id = t.decision_id join slots sl on sl.id = d.slot_id
             where t.bot_id = r.bot_id and t.tx_hash is not null and sl.slot_time < $2::timestamptz) as trades,
            (select count(*)::int from season_results x where x.bot_id = r.bot_id and x.season_id <= $1::int) as seasons
     from season_results r where r.season_id = $1::int order by r.bot_id`,
    [season, s.ends_at],
  );
  if (bots.length === 0) return [];
  const ids = bots.map((b) => b.id);

  const { rows: marks } = await db.query<{ bot_id: string; slot_time: Date; value_e8: string }>(
    `select m.bot_id::text as bot_id, sl.slot_time, m.value_e8::text as value_e8
     from portfolio_marks m join slots sl on sl.id = m.slot_id
     where m.bot_id = any($1::bigint[]) and sl.slot_time < $2::timestamptz order by sl.slot_time, sl.id`,
    [ids, s.ends_at],
  );
  const { rows: decisions } = await db.query<{
    id: string; bot_id: string; gate_result: StoredGate | null; reason: string | null; reason_tag: string | null; input_json: unknown;
  }>(
    `select d.id::text as id, d.bot_id::text as bot_id, d.gate_result, d.reason, d.reason_tag, d.input_json
     from decisions d join slots sl on sl.id = d.slot_id
     where d.bot_id = any($1::bigint[]) and sl.slot_time < $2::timestamptz order by sl.slot_time`,
    [ids, s.ends_at],
  );
  const { rows: trades } = await db.query<{ decision_id: string; asset: AssetId; side: "BUY" | "SELL" }>(
    `select t.decision_id::text as decision_id, t.asset::text as asset, t.side::text as side
     from trades t join decisions d on d.id = t.decision_id join slots sl on sl.id = d.slot_id
     where t.bot_id = any($1::bigint[]) and t.tx_hash is not null and sl.slot_time < $2::timestamptz`,
    [ids, s.ends_at],
  );
  const tradesOf = new Map<string, typeof trades>();
  for (const t of trades) tradesOf.set(t.decision_id, [...(tradesOf.get(t.decision_id) ?? []), t]);

  return bots.map((bot) => {
    const points: MarkPoint[] = marks
      .filter((m) => m.bot_id === bot.id)
      .map((m) => ({ slotTime: new Date(m.slot_time), valueE8: BigInt(m.value_e8) }));
    const own = decisions.filter((d) => d.bot_id === bot.id);

    let proposed = 0;
    let penalised = 0;
    let executed = 0;
    let valid = 0;
    for (const d of own) {
      const counts = f1Counts(d.gate_result);
      proposed += counts.proposed;
      penalised += counts.penalised;
      const done = tradesOf.get(d.id) ?? [];
      if (done.length === 0) continue;
      executed++;
      const decision: ExecutedDecision = {
        reason: d.reason,
        reasonTag: d.reason_tag,
        trades: done.map((t) => ({ asset: t.asset, side: t.side })),
        chg24hPct: changesOf(readExact(d.input_json)),
      };
      if (reasonPasses(decision)) valid++;
    }

    const factors = withTotal({
      fRules: fRules(proposed, penalised),
      fDrawdown: fDrawdown([startCashE8, ...points.map((p) => p.valueE8)]),
      fConsistency: fConsistency(dailyReturns(startCashE8, points)),
      fExplains: fExplains(valid, executed),
    });
    const botId = BigInt(bot.id);
    return {
      ...factors,
      botId,
      provisional: bot.trades < s.min_trades || bot.seasons < 1,
      leaf: trustLeaf(season, botId, factors),
    };
  });
}

export async function saveTrustScores(db: Queryable, season: number, rulesVersion: string, scores: readonly TrustScore[]): Promise<void> {
  for (const t of scores) {
    await db.query(
      `insert into trust_scores
         (season_id, bot_id, rules_version, f_rules, f_drawdown, f_consistency, f_explains, total, provisional, leaf_hash)
       values ($1::int, $2::bigint, $3::text, $4::int, $5::int, $6::int, $7::int, $8::int, $9::boolean, decode($10::text, 'hex'))
       on conflict (season_id, bot_id) do update set
         rules_version = excluded.rules_version, f_rules = excluded.f_rules, f_drawdown = excluded.f_drawdown,
         f_consistency = excluded.f_consistency, f_explains = excluded.f_explains, total = excluded.total,
         provisional = excluded.provisional, leaf_hash = excluded.leaf_hash`,
      [season, t.botId.toString(), rulesVersion, t.fRules, t.fDrawdown, t.fConsistency, t.fExplains, t.total, t.provisional, t.leaf.slice(2)],
    );
  }
}

export interface ScoresFile {
  root: Hex;
  text: string;
}

/** The public scores file: every leaf in botId order, which is the tree's order. Anyone can rebuild the root from it. */
export function scoresFile(season: number, rulesVersion: string, scores: readonly TrustScore[]): ScoresFile {
  const ordered = [...scores].sort((a, b) => (a.botId < b.botId ? -1 : a.botId > b.botId ? 1 : 0));
  const root = merkleRoot(ordered.map((t) => t.leaf));
  const text = canonicalJson({
    type: "trust_scores",
    season,
    rules_version: rulesVersion,
    root,
    leaf: "keccak256(abi.encode(uint32 season, uint256 botId, uint16 fRules, uint16 fDrawdown, uint16 fConsistency, uint16 fExplains, uint16 total))",
    scores: ordered.map((t) => ({
      bot_id: t.botId.toString(),
      f_rules: t.fRules,
      f_drawdown: t.fDrawdown,
      f_consistency: t.fConsistency,
      f_explains: t.fExplains,
      total: t.total,
      provisional: t.provisional,
      leaf: t.leaf,
    })),
  });
  return { root, text };
}

export interface ScoreProof extends TrustFactors {
  season: number;
  botId: string;
  rulesVersion: string;
  provisional: boolean;
  leaf: Hex;
  proof: Hex[];
  root: Hex;
  /** What the chain holds, once the indexer has seen `ScoresCommitted`. Null before. */
  committedRoot: Hex | null;
  scoresTx: string | null;
}

/** A bot's score and the proof for `TrustScoreRegistry.verifyScore`, rebuilt from the season's stored scores. */
export async function scoreProof(db: Queryable, season: number, botId: bigint): Promise<ScoreProof | null> {
  const { rows } = await db.query<{
    bot_id: string; rules_version: string; f_rules: number; f_drawdown: number; f_consistency: number; f_explains: number;
    total: number; provisional: boolean; root: string | null; tx: string | null;
  }>(
    `select t.bot_id::text as bot_id, t.rules_version, t.f_rules, t.f_drawdown, t.f_consistency, t.f_explains, t.total,
            t.provisional, encode(s.scores_root, 'hex') as root, s.scores_tx as tx
     from trust_scores t join seasons s on s.id = t.season_id
     where t.season_id = $1::int order by t.bot_id`,
    [season],
  );
  const index = rows.findIndex((r) => r.bot_id === botId.toString());
  if (index < 0) return null;

  // Leaves are rebuilt from the factors, so a proof never rests on a stored hash.
  const leaves = rows.map((r) =>
    trustLeaf(season, BigInt(r.bot_id), { fRules: r.f_rules, fDrawdown: r.f_drawdown, fConsistency: r.f_consistency, fExplains: r.f_explains, total: r.total }),
  );
  const r = rows[index]!;
  return {
    season,
    botId: r.bot_id,
    rulesVersion: r.rules_version,
    fRules: r.f_rules,
    fDrawdown: r.f_drawdown,
    fConsistency: r.f_consistency,
    fExplains: r.f_explains,
    total: r.total,
    provisional: r.provisional,
    leaf: leaves[index]!,
    proof: merkleProof(leaves, index),
    root: merkleRoot(leaves),
    committedRoot: r.root ? (`0x${r.root}` as Hex) : null,
    scoresTx: r.tx,
  };
}
