import { loadWorkerConfig } from "./config";
import { createQiePublicClient } from "./chain";
import { committerSender, dailyCallJobs } from "./daily-call";
import { HealthState, startOracleMonitor } from "./health";
import { startIndexer } from "./indexer";
import { startScheduler } from "./scheduler";
import { seasonJobs } from "./seasons";
import { runnerJobs } from "./slot";
import { personaRoutes } from "./persona/route";
import { setUpPersona } from "./persona/setup";
import { createWorkerServer } from "./server";
import { loadAllowedOrigins } from "./auth/cors";
import { createClientIp } from "./auth/client-ip";
import { consoleLog } from "./auth/log";
import { authRoutes } from "./auth/routes";
import { setUpAuth } from "./auth/setup";
import { relayRoutes } from "./relay/route";
import { databaseConfig, openDb } from "./relay/db";
import { setUpRelayer } from "./relay/setup";
import { trustRoutes } from "./trust/route";

/** Render web service entry point (SPEC §10). Keys stay in Render env; nothing secret is logged. */
async function main(): Promise<void> {
  const cfg = loadWorkerConfig();
  const client = createQiePublicClient(cfg);
  const health = new HealthState({ provider: cfg.llm.provider, capUsd: cfg.llm.monthlyBudgetUsd });
  const stopOracle = startOracleMonitor(client, cfg.feeds, health, cfg.oracleRefreshMs);
  const indexer = startIndexer({ rpcUrls: cfg.rpcUrls });
  const committer = committerSender(process.env, cfg.rpcUrls);
  const scheduler = startScheduler({
    health,
    jobs: [
      ({ db, log }) => seasonJobs({ db, log, env: process.env, client, rpcUrls: cfg.rpcUrls, committer }),
      ({ db, log }) => dailyCallJobs({ db, log, env: process.env, client, feeds: cfg.feeds, committer }),
      ({ db, log }) => runnerJobs({ db, log, env: process.env, cfg, client, health }),
    ],
  });

  const origins = loadAllowedOrigins(process.env);
  const clientIp = createClientIp(process.env);
  const auth = setUpAuth(process.env);
  if (auth.problems.length) consoleLog("auth.not_configured", { env: auth.problems.join(",") });
  const relayer = setUpRelayer({ env: process.env, auth, rpcUrls: cfg.rpcUrls, log: consoleLog });
  if (!relayer.relay) consoleLog("relay.disabled", { env: relayer.problems.join(",") });
  relayer.start();
  const persona = setUpPersona({ env: process.env, cfg, health, log: consoleLog });
  if (!persona.service) consoleLog("persona.disabled", { env: persona.problems.join(",") });
  // Small read-only pool for the public proof route.
  const database = databaseConfig(process.env.DATABASE_URL);
  const reads = database ? openDb({ ...database, max: 2 }, consoleLog) : null;
  if (!reads) consoleLog("trust.proofs_disabled", { env: "DATABASE_URL" });
  const routes = {
    ...authRoutes({ origins, clientIp, log: consoleLog, siwe: auth.siwe }),
    ...relayRoutes({ relay: relayer.relay, origins, clientIp }),
    ...personaRoutes({ origins, auth: auth.authenticator, clientIp, log: consoleLog, service: persona.service }),
    ...trustRoutes({ db: reads, origins, clientIp }),
  };
  const server = createWorkerServer({ health, routes });
  server.listen(cfg.port, () => {
    const hosts = cfg.rpcUrls.map((u) => new URL(u).host).join(" → ");
    console.log(`[worker] listening on :${cfg.port} · chain ${cfg.chainId} · rpc ${hosts} · llm ${cfg.llm.provider}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[worker] ${signal} — shutting down`);
    stopOracle();
    // Let a broadcast and an indexer batch in progress finish, then close.
    void Promise.allSettled([relayer.stop(), indexer?.stop(), scheduler?.stop(), persona.stop(), reads?.close()]).then(() => server.close(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((e) => {
  console.error("[worker] failed to start:", e instanceof Error ? e.message : e);
  process.exit(1);
});
