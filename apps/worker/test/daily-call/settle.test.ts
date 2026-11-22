import { istDay } from "@botfolio/shared";
import { describe, expect, it, vi } from "vitest";
import type { OracleReading } from "../../src/oracle";
import type { Queryable } from "../../src/scheduler/db";
import { SETTLE_BATCH, settleDailyCalls, type DailyCallChain } from "../../src/daily-call/settle";

const ist = (time: string) => new Date(`${time}+05:30`);
const seconds = (time: string) => ist(time).getTime() / 1000;
const DAY = istDay(seconds("2026-11-24T21:00:00"));

function run(opts: { at: string; updatedAt: string; fresh?: boolean; bots?: number; settled?: bigint[]; abort?: boolean }) {
  const asked: unknown[] = [];
  const db: Queryable = {
    async query<Row extends object>(_sql: string, params?: unknown[]) {
      asked.push(...(params ?? []));
      return { rows: Array.from({ length: opts.bots ?? 2 }, (_, i) => ({ id: String(i + 1) })) as Row[] };
    },
  };
  const sent: { ids: bigint[]; day: number }[] = [];
  const chain: DailyCallChain = {
    settled: async (id) => opts.settled?.includes(id) ?? false,
    settle: async (ids, day) => void sent.push({ ids: [...ids], day }),
  };
  const btc = { fresh: opts.fresh ?? true, updatedAt: seconds(opts.updatedAt), roundId: "51707" } as OracleReading;
  const done = settleDailyCalls({
    db,
    chain,
    readBtc: async () => btc,
    scheduledFor: ist(opts.at),
    now: ist(opts.at),
    signal: opts.abort ? AbortSignal.abort() : new AbortController().signal,
    log: { info: vi.fn(), warn: vi.fn() },
  });
  return { done, sent, asked };
}

describe("settleDailyCalls", () => {
  it("settles the day at 21:00 on a round from 21:00", async () => {
    const r = run({ at: "2026-11-24T21:00:00", updatedAt: "2026-11-24T21:00:00" });
    expect(await r.done).toBe(2);
    expect(r.sent).toEqual([{ ids: [1n, 2n], day: DAY }]);
  });

  it.each([
    ["a round from 20:59:59", "2026-11-24T20:59:59", true],
    ["a stale round", "2026-11-24T21:01:00", false],
  ])("waits, without paying, for %s", async (_name, updatedAt, fresh) => {
    const r = run({ at: "2026-11-24T21:10:00", updatedAt, fresh });
    expect(await r.done).toBe(0);
    expect(r.sent).toEqual([]);
  });

  it("the next 09:00 settles yesterday", async () => {
    const r = run({ at: "2026-11-25T09:00:00", updatedAt: "2026-11-25T08:55:00" });
    await r.done;
    expect(r.asked).toEqual([DAY]);
    expect(r.sent[0]!.day).toBe(DAY);
  });

  it("doesn't send what the chain already settled and the indexer hasn't written", async () => {
    const r = run({ at: "2026-11-24T21:10:00", updatedAt: "2026-11-24T21:05:00", settled: [1n, 2n] });
    expect(await r.done).toBe(0);
    expect(r.sent).toEqual([]);
  });

  it("splits big days into batches", async () => {
    const r = run({ at: "2026-11-24T21:00:00", updatedAt: "2026-11-24T21:00:00", bots: SETTLE_BATCH + 1 });
    await r.done;
    expect(r.sent.map((s) => s.ids.length)).toEqual([SETTLE_BATCH, 1]);
  });

  it("sends nothing once shutting down", async () => {
    const r = run({ at: "2026-11-24T21:00:00", updatedAt: "2026-11-24T21:00:00", abort: true });
    expect(await r.done).toBe(0);
  });
});
