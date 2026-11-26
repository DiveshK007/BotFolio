import { stringToHex, zeroHash, type Hex } from "viem";
import { revealOutputHashes } from "../decisions/secrecy";
import type { Queryable } from "../scheduler/db";
import type { Log } from "../scheduler/log";
import { computeTrustScores, saveTrustScores, scoresFile } from "../trust/scores";
import { settleChallenges, type ChallengeChain } from "./challenges";
import { buildReplayFile, type ReplayContracts } from "./replay-file";
import { computeSeasonResults, saveSeasonResults } from "./results";
import type { ReplayStore } from "./storage";
import { verifyOffline } from "./verify";

export interface CloseChain extends ChallengeChain {
  isClosed(season: number): Promise<boolean>;
  closeSeason(season: number, root: Hex, uri: string): Promise<void>;
  startCashE8(): Promise<bigint>;
  /** `PaperLedger.usedOrder(orderId)`: the chain's word on whether an order executed. */
  orderUsed(orderId: Hex): Promise<boolean>;
  /** `TrustScoreRegistry.scoresRoot(season)`, zero before the first commit. */
  scoresRoot(season: number): Promise<Hex>;
  /** Whether `publishRules` ran for this version: `commitScores` reverts for an unknown one. */
  rulesPublished(version: Hex): Promise<boolean>;
  commitScores(season: number, version: Hex, root: Hex, uri: string): Promise<void>;
}

export interface CloseDeps {
  db: Queryable;
  chain: CloseChain;
  store: ReplayStore;
  contracts: ReplayContracts;
  log: Log;
  now(): Date;
}

/**
 * The close of every `closing` season (SPEC §2.3, #56): results and battle ranks, trust scores and their root
 * (§7, #58, #59), the replay file uploaded and read back, `closeSeason` with its root, then each challenge settled
 * or expired (§4.8, #61). The indexer makes the row `closed` from the event.
 *
 * A closed season whose scores aren't on-chain yet (the rules weren't published in time), or that still has open
 * or accepted challenges, is picked up again by the next run for those steps only.
 *
 * Safe to run again at any step. Each root is compared with the chain's first, so nothing is sent twice.
 */
export async function closeSeasons(deps: CloseDeps, signal: AbortSignal): Promise<number[]> {
  const { db, chain, store, contracts, log } = deps;
  const { rows } = await db.query<{ id: number; status: string }>(
    `select id, status::text as status from seasons s
     where status = 'closing'
        or (status = 'closed' and (scores_root is null
            or exists (select 1 from challenges c where c.season_id = s.id and c.status in ('open', 'accepted'))))
     order by id`,
  );
  const closed: number[] = [];

  for (const { id: season, status } of rows) {
    if (signal.aborted) break;
    const dataClosed = status === "closed" || (await chain.isClosed(season));
    const startCash = await chain.startCashE8();

    if (!dataClosed) {
      await checkIndexed(deps, season);
      // Every hash the file needs: the day's Daily Call cutoff (20:00) is before every close (21:30).
      await revealOutputHashes(db, deps.now());
      await saveSeasonResults(db, season, await computeSeasonResults(db, season, startCash));
    }
    await commitTrustScores(deps, season, startCash, dataClosed);
    if (dataClosed) {
      await settleChallenges(deps, season);
      continue;
    }

    const file = await buildReplayFile(db, season, contracts);
    // A file that doesn't replay would commit a root nobody can check.
    const check = verifyOffline(file.text);
    if (check.findings.length > 0 || check.root !== file.root) {
      log.warn("season.replay_failed", { season, findings: check.findings.slice(0, 5) });
      throw new Error(`season ${season}: the replay file doesn't verify`);
    }
    const uri = await upload(store, `season-${season}.jsonl`, file.text);
    await chain.closeSeason(season, file.root, uri);
    closed.push(season);
    log.info("season.closed", { season, root: file.root, lines: file.lines.length, uri });
    // `settle` and `expire` need the season closed on-chain, which it now is.
    await settleChallenges(deps, season);
  }
  return closed;
}

const ORDER_READS_AT_ONCE = 10;

/**
 * Throws while an order of this season executed on-chain but its trade isn't indexed yet (#353), so the results,
 * scores and replay file never lock in a missing trade. The caller's retry waits for the indexer.
 *
 * The frozen schema has no indexer cursor, so this asks the chain about every orderId the season's decisions logged
 * (orders, retries, big moves, shrinks) that has no indexed trade. Executed ones have a row and aren't read.
 * shortcut: a batch still unmined when this runs isn't seen; the last retry is at +15 min, so it would need a
 * 15 min wait to be mined. Upgrade to "no slot run holds its lock" if that ever happens.
 */
export async function checkIndexed(deps: Pick<CloseDeps, "db" | "chain" | "log">, season: number): Promise<void> {
  const { rows } = await deps.db.query<{ order_id: Hex }>(
    `select distinct o.order_id
     from decisions d join slots s on s.id = d.slot_id,
          lateral (select lower(v #>> '{}') as order_id from jsonb_path_query(d.gate_result, '$.**.orderId') v) o
     where s.season_id = $1::int and o.order_id ~ '^0x[0-9a-f]{64}$'
       and not exists (select 1 from trades t
                       where t.order_id = decode(substr(o.order_id, 3), 'hex') and t.tx_hash is not null)
     order by 1`,
    [season],
  );
  const missing: Hex[] = [];
  for (let i = 0; i < rows.length; i += ORDER_READS_AT_ONCE) {
    const chunk = rows.slice(i, i + ORDER_READS_AT_ONCE).map((r) => r.order_id);
    const used = await Promise.all(chunk.map((id) => deps.chain.orderUsed(id)));
    missing.push(...chunk.filter((_, j) => used[j]));
  }
  if (missing.length > 0) {
    deps.log.warn("season.trades_not_indexed", { season, orders: missing.length, first: missing[0] });
    throw new Error(`season ${season}: ${missing.length} executed orders aren't indexed yet`);
  }
}

/** Scores every bot with a result, saves them, and commits their root unless the chain already has it. */
async function commitTrustScores(deps: CloseDeps, season: number, startCash: bigint, dataClosed: boolean): Promise<void> {
  const { db, chain, store, log } = deps;
  const { rows } = await db.query<{ rules: string | null }>("select trust_rules_version as rules from seasons where id = $1::int", [season]);
  const rules = rows[0]?.rules;
  if (!rules) {
    log.warn("season.no_trust_rules_version", { season });
    return;
  }

  const scores = await computeTrustScores(db, season, startCash);
  if (scores.length === 0) {
    log.info("season.no_trust_scores", { season });
    return;
  }
  const file = scoresFile(season, rules, scores);
  const onChain = (await chain.scoresRoot(season)).toLowerCase();
  if (dataClosed && onChain !== zeroHash && onChain !== file.root.toLowerCase()) {
    // A closed season's root is locked (#219 item 4): commitScores would revert and hold up its challenges. The DB
    // keeps the committed rows, or /trust/proof would serve proofs the chain rejects (#354).
    log.warn("season.scores_locked", { season, onChain, computed: file.root });
    return;
  }
  await saveTrustScores(db, season, rules, scores);
  if (onChain === file.root.toLowerCase()) return;
  const version = stringToHex(rules, { size: 32 });
  if (!(await chain.rulesPublished(version))) {
    // Not a reason to hold back the season's data root. The next run tries again.
    log.warn("season.trust_rules_unpublished", { season, rules });
    return;
  }
  const uri = await upload(store, `season-${season}-scores.json`, file.text);
  await chain.commitScores(season, version, file.root, uri);
  log.info("season.scores_committed", { season, rules, root: file.root, bots: scores.length, uri });
}

/** Uploads and reads the public copy back: a root must only point at a file that says what it hashes. */
async function upload(store: ReplayStore, name: string, text: string): Promise<string> {
  const uri = await store.put(name, text);
  if ((await store.get(uri)) !== text) throw new Error(`${name}: the public file isn't what was uploaded`);
  return uri;
}
