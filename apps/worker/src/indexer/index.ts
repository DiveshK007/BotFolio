import type { HealthState } from "../health";
import { createChainSource } from "./chain";
import { loadIndexerConfig, type DatabaseConfig } from "./config";
import { createPgDb, type Db } from "./db";
import { Indexer } from "./indexer";
import { consoleLog, type Log } from "./log";
import { runLoop } from "./loop";

export interface StartOptions {
  /** In failover order (config.ts `orderRpcUrls`). */
  rpcUrls: string[];
  env?: Record<string, string | undefined>;
  log?: Log;
  openDb?: (database: DatabaseConfig) => Db;
  /** Told why it didn't start, for /healthz and the alerts. */
  health?: Pick<HealthState, "addStartProblem">;
}

/**
 * The worker's entry point. With addresses, start block or database missing it doesn't start and says which,
 * and the rest of the worker keeps running.
 */
export function startIndexer(options: StartOptions): { stop(): Promise<void> } | null {
  const { rpcUrls, env = process.env, log = consoleLog, openDb = createPgDb, health } = options;
  const loaded = loadIndexerConfig(env);
  if (!loaded.ok) {
    log.warn("NOT started", { problems: loaded.problems });
    health?.addStartProblem(`indexer not started: ${loaded.problems.join(", ")}`);
    return null;
  }

  const { database, addresses, startBlock } = loaded.config;
  const db = openDb(database);
  const sources = rpcUrls.map((url) => createChainSource(url, addresses));
  const loop = runLoop(new Indexer({ db, sources, addresses, startBlock, log }), log);
  log.info("started", { startBlock, rpc: sources.map((source) => source.name) });

  return {
    async stop() {
      await loop.stop();
      await db.close();
    },
  };
}
