import { loadWorkerConfig } from "./config";
import { createQiePublicClient } from "./chain";
import { HealthState, startOracleMonitor } from "./health";
import { startIndexer } from "./indexer";
import { createWorkerServer } from "./server";

/** Render web service entry point (SPEC §10). Keys stay in Render env; nothing secret is logged. */
async function main(): Promise<void> {
  const cfg = loadWorkerConfig();
  const client = createQiePublicClient(cfg);
  const health = new HealthState({ provider: cfg.llm.provider, capUsd: cfg.llm.monthlyBudgetUsd });
  const stopOracle = startOracleMonitor(client, cfg.feeds, health, cfg.oracleRefreshMs);
  const indexer = startIndexer({ rpcUrls: cfg.rpcUrls });

  const server = createWorkerServer({ health });
  server.listen(cfg.port, () => {
    const hosts = cfg.rpcUrls.map((u) => new URL(u).host).join(" → ");
    console.log(`[worker] listening on :${cfg.port} · chain ${cfg.chainId} · rpc ${hosts} · llm ${cfg.llm.provider}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[worker] ${signal} — shutting down`);
    stopOracle();
    const indexerStopped = indexer?.stop().catch((e) => console.error("[indexer] stop failed", e));
    server.close(() => void Promise.resolve(indexerStopped).then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((e) => {
  console.error("[worker] failed to start:", e instanceof Error ? e.message : e);
  process.exit(1);
});
