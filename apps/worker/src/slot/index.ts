import { createLlmClient, type LlmClient } from "@botfolio/llm";
import { isAddress, zeroAddress, type Address, type PublicClient } from "viem";
import type { Env } from "../auth/env";
import type { WorkerConfig } from "../config";
import { decisionPrompt } from "../decision/prompt";
import type { HealthState } from "../health";
import { readAllFeeds } from "../oracle";
import type { Db } from "../scheduler/db";
import type { Log } from "../scheduler/log";
import type { JobSet } from "../scheduler/scheduler";
import { systemAccount } from "../system/key";
import { createSystemSender } from "../system/sender";
import { createRunnerChain } from "./chain";
import { DebutWatcher } from "./debut";
import type { RunnerDeps } from "./deps";
import { runSlot } from "./run";
import { sweepBigMoves } from "../big-moves/sweep";

interface RunnerJobsOptions {
  db: Db;
  env: Env;
  cfg: WorkerConfig;
  client: PublicClient;
  health: HealthState;
  log: Log;
}

/** The slot job and the debut watcher, or why they can't run (variable names only, never values). */
export function runnerJobs({ db, env, cfg, client, health, log }: RunnerJobsOptions): JobSet {
  const problems: string[] = [];
  const address = (name: string): Address => {
    const value = env[name]?.trim().toLowerCase() ?? "";
    if (!isAddress(value) || value === zeroAddress) problems.push(name);
    return value as Address;
  };
  const registry = address("BOT_REGISTRY_ADDRESS");
  const paperLedger = address("PAPER_LEDGER_ADDRESS");
  const dailyCall = address("DAILY_CALL_ADDRESS");
  const runner = systemAccount(env, "RUNNER_PRIVATE_KEY");
  if (!runner) problems.push("RUNNER_PRIVATE_KEY");

  try {
    decisionPrompt(cfg.llm.promptVersion);
  } catch {
    problems.push("PROMPT_VERSION");
  }
  let llm: LlmClient | null = null;
  // The fake replies "{}", so every bot would hold for ever and look as if it were working.
  if (cfg.llm.provider === "fake") problems.push("LLM_PROVIDER");
  else {
    try {
      llm = createLlmClient({ env });
    } catch {
      problems.push({ xai: "XAI_API_KEY", openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" }[cfg.llm.provider]);
    }
  }
  if (problems.length > 0 || !runner || !llm) {
    const why = `needs ${problems.join(", ")}`;
    return { handlers: {}, unavailable: { slot: why, big_move_sweep: why } };
  }

  const sender = createSystemSender({ rpcUrls: cfg.rpcUrls, account: runner });
  const deps: RunnerDeps = {
    db,
    chain: createRunnerChain({ client, registry, ledger: paperLedger, sender }),
    readPrices: (nowSeconds) => readAllFeeds(client, cfg.feeds, nowSeconds),
    llm,
    llmConfig: cfg.llm,
    bigMove: cfg.bigMove,
    runner,
    paperLedger,
    dailyCall,
    health,
    log,
    now: () => new Date(),
  };
  return {
    unavailable: {},
    handlers: {
      slot: (context) => runSlot(deps, context),
      big_move_sweep: async ({ signal }) => void (await sweepBigMoves(deps, signal)),
    },
    service: new DebutWatcher(deps),
  };
}
