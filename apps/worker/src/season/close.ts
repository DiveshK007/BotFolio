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
  await saveTrustScores(db, season, rules, scores);

  const file = scoresFile(season, rules, scores);
  const onChain = (await chain.scoresRoot(season)).toLowerCase();
  if (onChain === file.root.toLowerCase()) return;
  if (dataClosed && onChain !== zeroHash) {
    // A closed season's root is locked (#219 item 4): commitScores would revert and hold up its challenges.
    log.warn("season.scores_locked", { season, onChain, computed: file.root });
    return;
  }
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
