import { createLlmClient } from "@botfolio/llm";
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
import { leaderboardRoutes } from "./season/route";
import { botPageRoutes } from "./bot-page/route";
import { mcpRoutes } from "./mcp/mcp";
import { verifyTrade } from "./mcp/verify-trade";
import { bigMoveRoutes } from "./big-moves/route";
import { dailyCallRoutes } from "./daily-call/route";
import { createCardChain } from "./cards/build";
import { cardJobs, startCardSweeper } from "./cards/jobs";
import { TARGET_ABIS } from "./relay/abis";
import { isAddress, type Address } from "viem";

/** Render web service entry point (SPEC §10). Keys stay in Render env; nothing secret is logged. */
async function main(): Promise<void> {
  const cfg = loadWorkerConfig();
  const client = createQiePublicClient(cfg);
  const health = new HealthState({ provider: cfg.llm.provider, capUsd: cfg.llm.monthlyBudgetUsd });
  const stopOracle = startOracleMonitor(client, cfg.feeds, health, cfg.oracleRefreshMs);
  const indexer = startIndexer({ rpcUrls: cfg.rpcUrls });
  const committer = committerSender(process.env, cfg.rpcUrls);
  // For v2 proposals at season close. Without a working provider every bot gets the deterministic fallback.
  let v2Llm: ReturnType<typeof createLlmClient> | null = null;
  if (cfg.llm.provider !== "fake") {
    try {
      v2Llm = createLlmClient({ env: process.env });
    } catch {
      consoleLog("v2.fallback_only", { env: "LLM_PROVIDER key" });
    }
  }
  const v2 = { llm: v2Llm, llmConfig: cfg.llm, resting: () => health.budget() === "resting" };
  const paperLedger = process.env.PAPER_LEDGER_ADDRESS?.trim().toLowerCase() ?? "";
  let startCash: Promise<bigint> | null = null;
  const startCashE8 = () => {
    // Immutable on-chain, so read once; a failed read is retried next time.
    startCash ??= client.readContract({ address: paperLedger as Address, abi: TARGET_ABIS.PaperLedger, functionName: "START_CASH_E8" }).then(
      (value) => value as bigint,
      (error: unknown) => {
        startCash = null;
        throw error;
      },
    );
    return startCash;
  };
  // Cards need START_CASH_E8 for the ₹ rule.
  const challengesAddress = process.env.CHALLENGES_ADDRESS?.trim().toLowerCase() ?? "";
  const cardChain = isAddress(paperLedger)
    ? createCardChain(client, startCashE8, isAddress(challengesAddress) ? (challengesAddress as Address) : null)
    : null;
  const scheduler = startScheduler({
    health,
    jobs: [
      ({ db, log }) => seasonJobs({ db, log, env: process.env, client, rpcUrls: cfg.rpcUrls, committer, v2 }),
      ({ db, log }) => dailyCallJobs({ db, log, env: process.env, client, feeds: cfg.feeds, committer }),
      ({ db, log }) => runnerJobs({ db, log, env: process.env, cfg, client, health }),
      ({ db, log }) => cardJobs({ db, log, chain: cardChain }),
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
  // Small pool for the public read routes and the card sweeper.
  const database = databaseConfig(process.env.DATABASE_URL);
  const reads = database ? openDb({ ...database, max: 2 }, consoleLog) : null;
  if (!reads) consoleLog("trust.proofs_disabled", { env: "DATABASE_URL" });
  const stopCards = reads && cardChain ? startCardSweeper({ db: reads, chain: cardChain, log: { info: consoleLog, warn: consoleLog } }) : null;
  const boards = reads && isAddress(paperLedger) ? { db: reads, startCashE8 } : null;
  if (!boards) consoleLog("leaderboards.disabled", { env: "DATABASE_URL,PAPER_LEDGER_ADDRESS" });
  const routes = {
    ...authRoutes({ origins, clientIp, log: consoleLog, siwe: auth.siwe }),
    ...relayRoutes({ relay: relayer.relay, origins, clientIp }),
    ...personaRoutes({ origins, auth: auth.authenticator, clientIp, log: consoleLog, service: persona.service }),
    ...trustRoutes({ db: reads, origins, clientIp }),
    ...bigMoveRoutes({ origins, auth: auth.authenticator, log: consoleLog, db: reads }),
    ...dailyCallRoutes({ origins, auth: auth.authenticator, log: consoleLog, db: reads }),
    ...leaderboardRoutes({ source: boards, origins, clientIp }),
    ...botPageRoutes({ source: boards, origins, clientIp }),
    ...mcpRoutes({
      source: boards && { ...boards, verifyTrade: (tx) => verifyTrade(client, paperLedger as Address, tx) },
      clientIp,
      log: consoleLog,
    }),
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
    void Promise.allSettled([relayer.stop(), indexer?.stop(), scheduler?.stop(), persona.stop(), (stopCards?.() ?? Promise.resolve()).then(() => reads?.close())]).then(() => server.close(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((e) => {
  console.error("[worker] failed to start:", e instanceof Error ? e.message : e);
  process.exit(1);
});
