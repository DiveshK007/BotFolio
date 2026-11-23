import type { Hex } from "viem";
import { revealOutputHashes } from "../decisions/secrecy";
import type { Queryable } from "../scheduler/db";
import type { Log } from "../scheduler/log";
import { buildReplayFile, type ReplayContracts } from "./replay-file";
import { computeSeasonResults, saveSeasonResults } from "./results";
import type { ReplayStore } from "./storage";
import { verifyOffline } from "./verify";

export interface CloseChain {
  isClosed(season: number): Promise<boolean>;
  closeSeason(season: number, root: Hex, uri: string): Promise<void>;
  startCashE8(): Promise<bigint>;
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
 * The close of every `closing` season (SPEC §2.3, #56): results and battle ranks, the replay file uploaded and
 * read back, then `closeSeason` with its root. The indexer makes the row `closed` from the event.
 *
 * Safe to run again at any step. A root is written once on-chain, so nothing is uploaded or sent for a season
 * the chain has already closed.
 */
export async function closeSeasons(deps: CloseDeps, signal: AbortSignal): Promise<number[]> {
  const { db, chain, store, contracts, log } = deps;
  const { rows } = await db.query<{ id: number }>("select id from seasons where status = 'closing' order by id");
  const closed: number[] = [];

  for (const { id: season } of rows) {
    if (signal.aborted) break;
    if (await chain.isClosed(season)) continue;

    // Every hash the file needs: the day's Daily Call cutoff (20:00) is before every close (21:30).
    await revealOutputHashes(db, deps.now());
    await saveSeasonResults(db, season, await computeSeasonResults(db, season, await chain.startCashE8()));

    const file = await buildReplayFile(db, season, contracts);
    // A file that doesn't replay would commit a root nobody can check.
    const check = verifyOffline(file.text);
    if (check.findings.length > 0 || check.root !== file.root) {
      log.warn("season.replay_failed", { season, findings: check.findings.slice(0, 5) });
      throw new Error(`season ${season}: the replay file doesn't verify`);
    }
    const uri = await store.put(`season-${season}.jsonl`, file.text);
    if ((await store.get(uri)) !== file.text) throw new Error(`season ${season}: the public file isn't what was uploaded`);

    await chain.closeSeason(season, file.root, uri);
    closed.push(season);
    log.info("season.closed", { season, root: file.root, lines: file.lines.length, uri });
  }
  return closed;
}
