import { createTask, type ScheduledTask } from "node-cron";
import type { HealthState } from "../health";
import type { Db } from "./db";
import { JOBS, type JobName } from "./jobs";
import { errorLabel, type Log } from "./log";
import { ensureScheduledSlot, type Slot } from "./slots";
import { slotAt } from "./times";

export interface JobContext {
  /** The cron time that fired. Key idempotency on this, not on the time the job happens to run. */
  scheduledFor: Date;
  /** Aborted on shutdown: don't begin new work. */
  signal: AbortSignal;
}

export interface SlotContext extends JobContext {
  slot: Slot;
  /** 0 at the slot, 1 to 3 on the stale retries. */
  attempt: number;
}

/**
 * Every handler has to be idempotent by itself. The lock only stops two runs overlapping, and it is gone
 * if its connection drops.
 */
export type JobHandlers = {
  /** `failed` is how many bots failed. They don't stop the slot, but /healthz says so. */
  slot?: (context: SlotContext) => Promise<{ failed: number }>;
} & { [Name in Exclude<JobName, "slot">]?: (context: JobContext) => Promise<void> };

/** A module's jobs: the ones it can run, and why for those it can't. */
export interface JobSet {
  handlers: JobHandlers;
  unavailable: Partial<Record<JobName, string>>;
  /** A loop that runs alongside the crons, such as the debut watcher. */
  service?: { start(): void; stop(): Promise<void> };
}

/** Safe to run whenever the worker starts: what they do follows the chain and the DB, not the clock alone. */
const RUN_AT_START: readonly JobName[] = ["season_open", "season_close"];

export interface SchedulerDeps {
  db: Db;
  handlers: JobHandlers;
  unavailable?: JobSet["unavailable"];
  health: HealthState;
  log: Log;
  now?: () => Date;
}

export type RunOutcome = "ran" | "failed" | "locked" | "outside_window" | "not_running";

export function createScheduler({ db, handlers, unavailable = {}, health, log, now = () => new Date() }: SchedulerDeps) {
  const tasks: ScheduledTask[] = [];
  const running = new Set<Promise<RunOutcome>>();
  const stopping = new AbortController();

  /** Never rejects: one job's failure can't take the worker or another job down. */
  function trigger(name: JobName, scheduledFor: Date = now()): Promise<RunOutcome> {
    if (stopping.signal.aborted || !handlers[name]) return Promise.resolve("not_running");
    const run = runOnce(name, scheduledFor).catch((error: unknown): RunOutcome => {
      log.warn("scheduler.job_failed", { job: name, scheduledFor, error: errorLabel(error) });
      health.recordJobRun(name, { at: now().toISOString(), problem: "failed" });
      return "failed";
    });
    running.add(run);
    void run.finally(() => running.delete(run));
    return run;
  }

  async function runOnce(name: JobName, scheduledFor: Date): Promise<RunOutcome> {
    const context = { scheduledFor, signal: stopping.signal };
    if (name !== "slot") {
      const result = await db.withLock(`job:${name}`, () => handlers[name]!(context));
      if (!result.acquired) return locked(name, scheduledFor);
      health.recordJobRun(name, { at: now().toISOString() });
      log.info("scheduler.job_done", { job: name, scheduledFor });
      return "ran";
    }

    // Placed by the clock, not by the cron date: a trigger that arrives late can be past the window.
    const moment = slotAt(now());
    if (!moment) {
      log.warn("scheduler.slot_outside_window", { scheduledFor });
      return "outside_window";
    }
    const { time, attempt } = moment;
    const result = await db.withLock(`slot:${time.toISOString()}`, async () => {
      const slot = await ensureScheduledSlot(db, time);
      const { failed } = await handlers.slot!({ ...context, slot, attempt });
      return { slot, failed };
    });
    if (!result.acquired) return locked(name, scheduledFor);

    const { slot, failed } = result.value;
    const finishedAt = now().toISOString();
    health.recordSlotRun({ slotId: slot.id, kind: slot.kind, slotTime: time.toISOString(), finishedAt });
    health.recordJobRun(name, { at: finishedAt, problem: failed > 0 ? `failed for ${failed} bot(s)` : undefined });
    log.info("scheduler.slot_done", { slotId: slot.id, slotTime: time, attempt, failed });
    return "ran";
  }

  function locked(name: JobName, scheduledFor: Date): RunOutcome {
    log.info("scheduler.already_running", { job: name, scheduledFor });
    return "locked";
  }

  return {
    trigger,

    start(): void {
      for (const { name, issue, crons } of JOBS) {
        if (!handlers[name]) {
          const why = unavailable[name];
          if (why) {
            health.setJob(name, "not_started", why);
            health.addStartProblem(`${name} job not started: ${why}`);
            log.warn("scheduler.job_not_started", { job: name, why });
          } else {
            health.setJob(name, "not_implemented", `#${issue}`);
          }
          continue;
        }
        health.setJob(name, "scheduled");
        for (const expression of crons) {
          const task = createTask(expression, (context) => trigger(name, context.date), {
            timezone: "UTC",
            name: `${name} ${expression}`,
            logger: cronLogger(log),
          });
          // A blocked event loop skips beats. The handlers are idempotent, so run it late.
          task.on("execution:missed", (context) => void trigger(name, context.date));
          void task.start();
          tasks.push(task);
        }
      }
      log.info("scheduler.started", { jobs: JOBS.filter(({ name }) => handlers[name]).map(({ name }) => name) });
      // A deploy or a crash inside a slot's window shouldn't cost the slot.
      if (slotAt(now())) void trigger("slot");
      // Deployed at 00:05, S0 mustn't wait a day for the next 00:00 check.
      for (const name of RUN_AT_START) void trigger(name);
    },

    /** Stops the timers and waits for what is running. */
    async stop(): Promise<void> {
      stopping.abort();
      for (const task of tasks.splice(0)) await task.destroy();
      await Promise.allSettled(running);
    },
  };
}

/** node-cron prints whole error objects by default. */
function cronLogger(log: Log) {
  return {
    info: () => {},
    debug: () => {},
    warn: () => log.warn("scheduler.cron_warning"),
    error: (error: unknown) => log.warn("scheduler.cron_error", { error: errorLabel(error) }),
  };
}
