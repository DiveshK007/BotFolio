import { describe, expect, it } from "vitest";
import { HealthState } from "../../src/health";
import { startScheduler } from "../../src/scheduler";
import type { Db } from "../../src/scheduler/db";
import { createScheduler, type JobHandlers, type SlotContext } from "../../src/scheduler/scheduler";
import { useTestDb } from "./helpers/db";
import { memoryLog } from "./helpers/log";

const db = useTestDb();
const NINE = new Date("2026-11-24T09:00:00+05:30");
const after = (minutes: number) => new Date(NINE.getTime() + minutes * 60_000);

function setUp(handlers: JobHandlers, options: { db?: Db; at?: Date } = {}) {
  const clock = { now: options.at ?? NINE };
  const health = new HealthState({ provider: "fake", capUsd: null });
  const log = memoryLog();
  const scheduler = createScheduler({ db: options.db ?? db, handlers, health, log, now: () => clock.now });
  return { scheduler, clock, health, log };
}

const slotRows = async () =>
  (await db.query<{ id: string; season_id: number | null }>("select id::text as id, season_id from slots")).rows;

function recorder() {
  const runs: SlotContext[] = [];
  const slot = async (context: SlotContext) => {
    runs.push(context);
    return { failed: 0 };
  };
  return { runs, slot };
}

describe("slots are idempotent by slot_id", () => {
  it("the slot, its retries, duplicates and a restart share one row", async () => {
    const { runs, slot } = recorder();
    const first = setUp({ slot });
    await first.scheduler.trigger("slot");
    await first.scheduler.trigger("slot");
    first.clock.now = after(5);
    await first.scheduler.trigger("slot");
    await setUp({ slot }, { at: after(10), db: db.secondProcess() }).scheduler.trigger("slot");

    const rows = await slotRows();
    expect(rows).toHaveLength(1);
    expect(runs.map((run) => run.slot.id)).toEqual(runs.map(() => rows[0]!.id));
    expect(runs.map((run) => run.attempt)).toEqual([0, 0, 1, 2]);
    expect(runs.every((run) => run.slot.time.getTime() === NINE.getTime())).toBe(true);
  });

  it("two processes racing with no lock still share one row", async () => {
    const { runs, slot } = recorder();
    const racers = Array.from({ length: 5 }, () => setUp({ slot }, { db: db.withoutLocks() }).scheduler);
    await Promise.all(racers.map((scheduler) => scheduler.trigger("slot")));
    expect(await slotRows()).toHaveLength(1);
    expect(new Set(runs.map((run) => run.slot.id)).size).toBe(1);
  });

  it("puts a slot in its season, and the 21:00 slot in the season that closes at 21:30", async () => {
    await db.query(
      `insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades) values
       (0, '2026-11-24T00:00:00+05:30', '2026-11-25T21:30:00+05:30', 'sprint', 8),
       (1, '2026-11-26T00:00:00+05:30', '2026-11-27T21:30:00+05:30', 'sprint', 8)`,
    );
    const { runs, slot } = recorder();
    for (const at of [NINE, new Date("2026-11-25T21:00:00+05:30"), new Date("2026-11-26T09:00:00+05:30")]) {
      await setUp({ slot }, { at }).scheduler.trigger("slot");
    }
    expect(runs.map((run) => run.slot.season?.id)).toEqual([0, 0, 1]);
    expect(runs[0]!.slot.season!.startsAt).toEqual(new Date("2026-11-24T00:00:00+05:30"));
  });

  it("runs outside every season, with none", async () => {
    const { runs, slot } = recorder();
    await setUp({ slot }).scheduler.trigger("slot");
    expect(runs[0]!.slot.season).toBeNull();
  });

  it("does nothing for a trigger after the window", async () => {
    const { runs, slot } = recorder();
    expect(await setUp({ slot }, { at: after(20) }).scheduler.trigger("slot", NINE)).toBe("outside_window");
    expect(runs).toEqual([]);
    expect(await slotRows()).toEqual([]);
  });
});

describe("the advisory lock", () => {
  it("a second process doesn't run a slot that is running", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered = () => {};
    const inside = new Promise<void>((resolve) => (entered = resolve));
    const first = setUp({
      slot: async () => {
        entered();
        await gate;
        return { failed: 0 };
      },
    });
    const { runs, slot } = recorder();
    const second = setUp({ slot }, { db: db.secondProcess(), at: after(5) });

    const running = first.scheduler.trigger("slot");
    await inside;
    expect(await second.scheduler.trigger("slot")).toBe("locked");
    release();
    expect(await running).toBe("ran");
    expect(runs).toEqual([]);
    expect(await second.scheduler.trigger("slot")).toBe("ran");
  });
});

describe("failures", () => {
  it("are contained, shown in /healthz without their message, and cleared by the next good run", async () => {
    let broken = true;
    const { scheduler, health, log } = setUp({
      slot: async () => {
        if (broken) throw Object.assign(new Error("row (secret-view) refused"), { code: "23514" });
        return { failed: 0 };
      },
    });
    expect(await scheduler.trigger("slot")).toBe("failed");
    expect(health.snapshot().reasons).toContain("slot job failed");
    expect(log.text()).toContain("23514");
    expect(log.text() + JSON.stringify(health.snapshot())).not.toContain("secret-view");

    broken = false;
    expect(await scheduler.trigger("slot")).toBe("ran");
    expect(health.snapshot().reasons).not.toContain("slot job failed");
  });

  it("bots that failed show up in /healthz", async () => {
    const { scheduler, health } = setUp({ slot: async () => ({ failed: 2 }) });
    await scheduler.trigger("slot");
    expect(health.snapshot().reasons).toContain("slot job failed for 2 bot(s)");
  });

  it("a database that is down fails the job, not the process", async () => {
    const down: Db = { ...db, withLock: async () => Promise.reject(new Error("ECONNREFUSED")) };
    expect(await setUp(recorder(), { db: down }).scheduler.trigger("slot")).toBe("failed");
  });
});

describe("start and stop", () => {
  it("catches up on a slot when the worker restarts inside its window", async () => {
    const { runs, slot } = recorder();
    const { scheduler } = setUp({ slot }, { at: after(7) });
    scheduler.start();
    await scheduler.stop();
    expect(runs.map((run) => [run.slot.time, run.attempt])).toEqual([[NINE, 1]]);
  });

  it("waits for a running job, tells it to wind down and takes no new one", async () => {
    let signal: AbortSignal | undefined;
    let finished = false;
    let entered = () => {};
    const inside = new Promise<void>((resolve) => (entered = resolve));
    const { scheduler } = setUp({
      slot: async (context) => {
        signal = context.signal;
        entered();
        await new Promise((resolve) => setTimeout(resolve, 20));
        finished = true;
        return { failed: 0 };
      },
    });
    void scheduler.trigger("slot");
    await inside;
    await scheduler.stop();
    expect(finished).toBe(true);
    expect(signal!.aborted).toBe(true);
    expect(await scheduler.trigger("slot")).toBe("not_running");
  });

  it("lists a job without a handler instead of scheduling it", async () => {
    const { scheduler, health } = setUp(recorder());
    scheduler.start();
    expect(await scheduler.trigger("recap")).toBe("not_running");
    await scheduler.stop();
    const { jobs } = health.snapshot();
    expect(jobs.slot?.state).toBe("scheduled");
    expect(jobs.recap).toMatchObject({ state: "not_implemented", detail: "#185" });
  });
});

describe("startScheduler", () => {
  it.each([undefined, "", "postgres://user:hunter2@db.example.com/x?sslmode=disable"])(
    "doesn't start with DATABASE_URL=%s, and says so without the value",
    (url) => {
      const health = new HealthState({ provider: "fake", capUsd: null });
      const log = memoryLog();
      let opened = false;
      const openDb = () => {
        opened = true;
        return db;
      };
      expect(startScheduler({ health, log, openDb, env: { DATABASE_URL: url } })).toBeNull();
      expect(opened).toBe(false);
      const { status, reasons } = health.snapshot();
      expect(status).toBe("degraded");
      expect(reasons.join()).toContain("scheduler not started: DATABASE_URL");
      expect(log.text()).toContain("DATABASE_URL");
      expect(reasons.join() + log.text()).not.toContain("hunter2");
    },
  );
});
