import type { PublicClient } from "viem";
import { budgetState, estimateCostUsd, type BudgetState, type LlmUsage } from "@botfolio/llm";
import type { FeedConfig } from "./config";
import { readAllFeeds, type OracleReading } from "./oracle";

export interface SlotRun {
  slotId: string;
  kind: "scheduled" | "debut";
  slotTime: string;
  finishedAt: string;
}

export interface JobHealth {
  state: "scheduled" | "not_implemented" | "not_started";
  detail?: string;
  lastRun?: JobRun;
}

export interface JobRun {
  at: string;
  /** Short and free of data: /healthz is public. */
  problem?: string;
}

export interface HealthPayload {
  status: "ok" | "degraded";
  reasons: string[];
  startedAt: string;
  now: string;
  lastSlotRun: SlotRun | null;
  jobs: Record<string, JobHealth>;
  oracle: { checkedAt: string | null; feeds: OracleReading[] };
  llm: { provider: string; month: string; spentUsd: number; capUsd: number | null; budget: BudgetState };
}

/**
 * In-process health facts served at /healthz (issue #36: last slot run, oracle freshness, LLM budget).
 * The web's degraded banner (#171) reads `status` + `reasons`.
 */
export class HealthState {
  readonly startedAt = new Date();
  private lastSlotRun: SlotRun | null = null;
  private readonly startProblems: string[] = [];
  private readonly jobs = new Map<string, JobHealth>();
  private oracleCheckedAt: Date | null = null;
  private oracleReadings: OracleReading[] = [];
  /** `usd` is decision spend, replaced by each refresh. `unloggedUsd` is calls with no table (persona), which a refresh must not wipe. */
  private spend = { month: "", usd: 0, unloggedUsd: 0 };

  constructor(
    private readonly llm: { provider: string; capUsd: number | null },
  ) {}

  recordSlotRun(run: SlotRun): void {
    this.lastSlotRun = run;
  }

  /** Something that didn't start. `problem` names env variables, never their values. */
  addStartProblem(problem: string): void {
    this.startProblems.push(problem);
  }

  setJob(name: string, state: JobHealth["state"], detail?: string): void {
    this.jobs.set(name, { state, detail });
  }

  recordJobRun(name: string, run: JobRun): void {
    this.jobs.set(name, { state: "scheduled", ...this.jobs.get(name), lastRun: run });
  }

  recordOracle(readings: OracleReading[], at: Date): void {
    this.oracleReadings = readings;
    this.oracleCheckedAt = at;
  }

  // Between two refreshes from the decisions log (src/budget/spend.ts), which is what survives a restart.
  recordLlmUsage(model: string, usage: LlmUsage, at: Date = new Date()): void {
    this.monthSpend(at).usd += estimateCostUsd(model, usage);
  }

  /**
   * A call the decisions log never sees (persona), so setLlmSpend keeps it.
   * shortcut: in memory, so a restart forgets it; persist it (a counter row monthSpendUsd reads) if persona spend grows.
   */
  recordUnloggedLlmUsage(model: string, usage: LlmUsage, at: Date = new Date()): void {
    this.monthSpend(at).unloggedUsd += estimateCostUsd(model, usage);
  }

  /** The month's decision spend as the decisions log has it (src/budget). Calls after this add to it. */
  setLlmSpend(usd: number, at: Date = new Date()): void {
    this.monthSpend(at).usd = usd;
  }

  private monthSpend(at: Date) {
    const month = monthKey(at);
    if (this.spend.month !== month) this.spend = { month, usd: 0, unloggedUsd: 0 };
    return this.spend;
  }

  budget(at: Date = new Date()): BudgetState {
    return budgetState(this.spentUsd(at), this.llm.capUsd);
  }

  private spentUsd(at: Date): number {
    return this.spend.month === monthKey(at) ? this.spend.usd + this.spend.unloggedUsd : 0;
  }

  snapshot(now: Date = new Date()): HealthPayload {
    const reasons: string[] = [...this.startProblems];
    for (const [name, job] of this.jobs) {
      if (job.lastRun?.problem) reasons.push(`${name} job ${job.lastRun.problem}`);
    }
    if (!this.oracleCheckedAt) reasons.push("oracle not checked yet");
    for (const r of this.oracleReadings) {
      if (r.error) reasons.push(`${r.asset} feed unreadable`);
      else if (!r.fresh) reasons.push(`${r.asset} price too old`);
    }
    const budget = this.budget(now);
    if (budget === "resting") reasons.push("LLM budget used up — bots resting");
    else if (budget === "alert") reasons.push("LLM budget above 80 %");

    return {
      status: reasons.length === 0 ? "ok" : "degraded",
      reasons,
      startedAt: this.startedAt.toISOString(),
      now: now.toISOString(),
      lastSlotRun: this.lastSlotRun,
      jobs: Object.fromEntries(this.jobs),
      oracle: { checkedAt: this.oracleCheckedAt?.toISOString() ?? null, feeds: this.oracleReadings },
      llm: {
        provider: this.llm.provider,
        month: monthKey(now),
        spentUsd: Number(this.spentUsd(now).toFixed(4)),
        capUsd: this.llm.capUsd,
        budget,
      },
    };
  }
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/** Refreshes the oracle snapshot on a timer so /healthz never waits on RPC. */
export function startOracleMonitor(
  client: PublicClient,
  feeds: FeedConfig[],
  health: HealthState,
  intervalMs: number,
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      health.recordOracle(await readAllFeeds(client, feeds, Math.floor(now.getTime() / 1000)), now);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
