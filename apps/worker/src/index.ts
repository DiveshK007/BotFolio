import { loadWorkerConfig } from "./config";
import { createQiePublicClient } from "./chain";
import { HealthState, startOracleMonitor } from "./health";
import { createWorkerServer } from "./server";
import { loadAllowedOrigins } from "./auth/cors";
import { createClientIp } from "./auth/client-ip";
import { consoleLog } from "./auth/log";
import { authRoutes } from "./auth/routes";
import { setUpAuth } from "./auth/setup";
import { relayRoutes } from "./relay/route";

/** Render web service entry point (SPEC §10). Keys stay in Render env; nothing secret is logged. */
async function main(): Promise<void> {
  const cfg = loadWorkerConfig();
  const client = createQiePublicClient(cfg);
  const health = new HealthState({ provider: cfg.llm.provider, capUsd: cfg.llm.monthlyBudgetUsd });
  const stopOracle = startOracleMonitor(client, cfg.feeds, health, cfg.oracleRefreshMs);

  const origins = loadAllowedOrigins(process.env);
  const clientIp = createClientIp(process.env);
  const auth = setUpAuth(process.env);
  if (auth.problems.length) consoleLog("auth.not_configured", { env: auth.problems.join(",") });
  const routes = {
    ...authRoutes({ origins, clientIp, log: consoleLog, siwe: auth.siwe }),
    // Off (503 RELAY_DISABLED) until limits and the nonce manager are wired in: #39, #40.
    ...relayRoutes({ relay: null, origins, clientIp }),
  };
  const server = createWorkerServer({ health, routes });
  server.listen(cfg.port, () => {
    const hosts = cfg.rpcUrls.map((u) => new URL(u).host).join(" → ");
    console.log(`[worker] listening on :${cfg.port} · chain ${cfg.chainId} · rpc ${hosts} · llm ${cfg.llm.provider}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[worker] ${signal} — shutting down`);
    stopOracle();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((e) => {
  console.error("[worker] failed to start:", e instanceof Error ? e.message : e);
  process.exit(1);
});
