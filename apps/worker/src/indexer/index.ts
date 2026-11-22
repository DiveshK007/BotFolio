import { createChainSource } from "./chain";
import { loadIndexerConfig } from "./config";
import { createPgDb, type Db } from "./db";
import { Indexer } from "./indexer";
import { consoleLog, type Log } from "./log";
import { runLoop } from "./loop";

export interface StartOptions {
  /** In failover order (config.ts `orderRpcUrls`). */
  rpcUrls: string[];
  env?: Record<string, string | undefined>;
  log?: Log;
  openDb?: (url: string) => Db;
}

/**
 * The worker's entry point. With addresses, start block or database missing it doesn't start and says which,
 * and the rest of the worker keeps running.
 */
export function startIndexer(options: StartOptions): { stop(): Promise<void> } | null {
  const { rpcUrls, env = process.env, log = consoleLog, openDb = createPgDb } = options;
  const loaded = loadIndexerConfig(env);
  if (!loaded.ok) {
    log.warn("NOT started", { problems: loaded.problems });
    return null;
  }

  const { databaseUrl, addresses, startBlock } = loaded.config;
  const db = openDb(databaseUrl);
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
