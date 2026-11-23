import type { LlmClient, LlmConfig } from "@botfolio/llm";
import type { Queryable } from "../scheduler/db";
import type { Log } from "../scheduler/log";
import { proposeV2, type V2Correction, type V2Input, type V2Proposal } from "./propose";

/** 21:30 close → 08:30 IST the next morning (SPEC §2.3 step 4). */
export const APPROVE_WINDOW_MS = 11 * 3_600_000;
/** The newest corrections the model reads per bot. */
export const MAX_CORRECTIONS = 20;
const CONCURRENCY = 4;

export interface V2Deps {
  db: Queryable;
  llm: LlmClient | null;
  llmConfig: Pick<LlmConfig, "models" | "temperature" | "timeoutMs">;
  /** True when the LLM budget is used up: proposals then come from the fallback. */
  resting(): boolean;
  log: Log;
  now(): Date;
}

interface BotRow {
  id: string;
  name: string;
  persona: string;
  version: number;
  rules: string;
  coin: number;
  trades_cap: number;
  return_bps: number;
  max_dd_bps: number;
  trades: number;
  battle_rank: number | null;
}

/**
 * A v2 proposal for every active raised bot of each season that closed in the approval window (SPEC §2.3, #57).
 * Proposals are `bot_versions` rows with no `committed_tx`, so the runner never uses them until the owner signs
 * `commitVersion` for their hash. Safe to run again: a bot with this season's proposal, or a committed next
 * version, is skipped; an older season's unapproved proposal is replaced.
 */
export async function proposeVersions(deps: V2Deps, signal: AbortSignal): Promise<number> {
  const { db, log } = deps;
  const now = deps.now();
  const { rows: seasons } = await db.query<{ id: number; starts_at: Date; ends_at: Date }>(
    `select id, starts_at, ends_at from seasons s
     where ends_at <= $1::timestamptz and ends_at > $2::timestamptz
       and exists (select 1 from season_results r where r.season_id = s.id)
     order by id`,
    [now.toISOString(), new Date(now.getTime() - APPROVE_WINDOW_MS).toISOString()],
  );

  let made = 0;
  for (const season of seasons) {
    if (signal.aborted) break;
    const { rows: bots } = await db.query<BotRow>(
      `select b.id::text as id, b.name, b.persona_text as persona, cur.version, cur.rules_text as rules,
              cur.max_per_coin_bps as coin, cur.max_trades_per_day as trades_cap,
              r.return_bps, r.max_dd_bps, r.trades, r.battle_rank
       from season_results r
       join bots b on b.id = r.bot_id
       join lateral (
         select v.version, v.rules_text, v.max_per_coin_bps, v.max_trades_per_day from bot_versions v
         where v.bot_id = b.id and (v.committed_tx is not null or v.source = 'create')
         order by v.version desc limit 1
       ) cur on true
       where r.season_id = $1::int and not b.is_house and b.status = 'active'
         and not exists (
           select 1 from bot_versions p
           where p.bot_id = b.id and p.version = cur.version + 1
             and (p.committed_tx is not null or p.config_json ->> 'season' = $1::text))
       order by b.id`,
      [season.id],
    );
    if (bots.length === 0) continue;

    const { rows: corrections } = await db.query<V2Correction & { bot_id: string }>(
      `select id::int as id, bot_id::text as bot_id, chip, note from corrections
       where bot_id = any($1::bigint[]) and tx_hash is not null
         and created_at >= $2::timestamptz and created_at < $3::timestamptz
       order by created_at desc, id desc`,
      [bots.map((b) => b.id), season.starts_at, season.ends_at],
    );

    const approveBy = new Date(new Date(season.ends_at).getTime() + APPROVE_WINDOW_MS);
    const queue = [...bots];
    const worker = async () => {
      for (let bot = queue.shift(); bot && !signal.aborted; bot = queue.shift()) {
        const input: V2Input = {
          botId: BigInt(bot.id),
          season: season.id,
          approveBy,
          name: bot.name,
          persona: bot.persona,
          current: { version: bot.version, rules: bot.rules, maxPerCoinBps: bot.coin, maxTradesPerDay: bot.trades_cap },
          results: { returnBps: bot.return_bps, maxDdBps: bot.max_dd_bps, trades: bot.trades, battleRank: bot.battle_rank },
          corrections: corrections
            .filter((c) => c.bot_id === bot.id)
            .slice(0, MAX_CORRECTIONS)
            .map(({ id, chip, note }) => ({ id, chip, note })),
        };
        const proposal = await proposeV2({ llm: deps.llm, config: deps.llmConfig, resting: deps.resting(), input });
        await saveProposal(db, proposal);
        made++;
        log.info("v2.proposed", {
          season: season.id,
          botId: bot.id,
          version: proposal.config.version,
          configHash: proposal.configHash,
          fallback: proposal.fallback,
          error: proposal.log.error,
          usage: proposal.log.usage,
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, bots.length) }, worker));
  }
  return made;
}

/** Never touches a committed version: the conflict update only applies while `committed_tx` is null. */
export async function saveProposal(db: Queryable, p: V2Proposal): Promise<void> {
  const c = p.config;
  await db.query(
    `insert into bot_versions
       (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source)
     values ($1::bigint, $2::int, $3::text, $4::int, $5::int, $6::jsonb, decode($7::text, 'hex'), 'season_v2')
     on conflict (bot_id, version) do update set
       rules_text = excluded.rules_text, max_per_coin_bps = excluded.max_per_coin_bps,
       max_trades_per_day = excluded.max_trades_per_day, config_json = excluded.config_json,
       config_hash = excluded.config_hash
     where bot_versions.committed_tx is null`,
    [c.bot_id, c.version, c.rules, c.max_per_coin_bps, c.max_trades_per_day, JSON.stringify(c), p.configHash.slice(2)],
  );
}
