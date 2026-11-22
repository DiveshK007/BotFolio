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
  private spend = { month: "", usd: 0 };

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

  // TODO(#32): month-to-date spend should be summed from logged decision usage in Postgres, so it
  // survives restarts. Until the schema lands this is in-memory only.
  recordLlmUsage(model: string, usage: LlmUsage, at: Date = new Date()): void {
    const month = monthKey(at);
    if (this.spend.month !== month) this.spend = { month, usd: 0 };
    this.spend.usd += estimateCostUsd(model, usage);
  }

  budget(at: Date = new Date()): BudgetState {
    return budgetState(this.spentUsd(at), this.llm.capUsd);
  }

  private spentUsd(at: Date): number {
    return this.spend.month === monthKey(at) ? this.spend.usd : 0;
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
