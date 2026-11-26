import { istDay } from "@botfolio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthState } from "../../src/health";
import type { Db } from "../../src/scheduler/db";
import { createScheduler, type JobHandlers } from "../../src/scheduler/scheduler";
import { settleDayFor } from "../../src/scheduler/times";
import { memoryLog } from "./helpers/log";

// The real node-cron on a fake clock, for a whole IST day.
const MIDNIGHT = new Date("2026-11-24T00:00:00+05:30");
const TZ = process.env.TZ;

afterEach(() => {
  vi.useRealTimers();
  if (TZ === undefined) delete process.env.TZ;
  else process.env.TZ = TZ;
});

const stubDb: Db = {
  query: async <Row extends object>(sql: string) => ({
    rows: (sql.trimStart().startsWith("select") ? [{ id: "1", season_id: null, starts_at: null }] : []) as Row[],
  }),
  transaction: async (run) => run(stubDb),
  withLock: async (_key, run) => ({ acquired: true, value: await run() }),
  close: async () => {},
};

const istTime = (date: Date) => new Date(date.getTime() + 19_800_000).toISOString().slice(11, 16);

/** "21:00", "21:10", … (every `step` minutes) */
function every10(from: string, to: string, step = 10): string[] {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const times: string[] = [];
  for (let m = minutes(from); m <= minutes(to); m += step) {
    times.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return times;
}

describe.each(["UTC", "America/New_York", "Asia/Kolkata"])("a day of cron with TZ=%s", (zone) => {
  it("fires every job at its IST time", async () => {
    process.env.TZ = zone;
    vi.useFakeTimers({ now: MIDNIGHT.getTime() - 1000 });

    const fired: Record<string, string[]> = {};
    const note = (name: string, text: string) => (fired[name] ??= []).push(text);
    const job = (name: string) => async ({ scheduledFor }: { scheduledFor: Date }) => void note(name, istTime(scheduledFor));
    const handlers: JobHandlers = {
      slot: async ({ scheduledFor, slot, attempt }) => {
        note("slot", `${istTime(scheduledFor)} slot ${istTime(slot.time)} attempt ${attempt}`);
        return { failed: 0 };
      },
      season_close: job("season_close"),
      season_open: job("season_open"),
      recap: job("recap"),
      big_move_sweep: job("big_move_sweep"),
      // Never finds a fresh price, so every retry of the day is needed.
      daily_call_settle: async ({ scheduledFor }) => {
        note("settle", `${istTime(scheduledFor)} day ${settleDayFor(scheduledFor)}`);
        throw new Error("no fresh price");
      },
    };
    const scheduler = createScheduler({
      db: stubDb,
      handlers,
      health: new HealthState({ provider: "fake", capUsd: null }),
      log: memoryLog(),
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(86_400_000 + 500);
    await scheduler.stop();

    expect(fired.slot).toEqual(
      ["09", "13", "17", "21"].flatMap((hour) =>
        ["00", "05", "10", "15"].map((minute, attempt) => `${hour}:${minute} slot ${hour}:00 attempt ${attempt}`),
      ),
    );
    // 23:59 is the check every worker start runs (#55). After it, the crons alone.
    // Retried through the night, so one failed close doesn't hold the next open for a day (#348).
    expect(fired.season_open).toEqual(["23:59", ...every10("00:00", "01:20")]);
    expect(fired.season_close).toEqual(["23:59", ...every10("21:30", "23:15", 15)]);
    expect(fired.recap).toEqual(["21:35"]);
    expect(fired.big_move_sweep).toEqual(every10("00:00", "23:50"));

    const today = istDay(MIDNIGHT.getTime() / 1000);
    expect(fired.settle).toEqual([
      `09:00 day ${today - 1}`,
      ...every10("21:00", "23:50").map((time) => `${time} day ${today}`),
    ]);
  });
});
