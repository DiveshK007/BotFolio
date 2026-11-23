import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeSeasonResults, dailyReturns, maxDrawdownBps, sortino } from "../../src/season/results";
import type { Queryable } from "../../src/scheduler/db";
import { testDb } from "../decisions/helpers";

const E8 = 100_000_000n;
const START = 1000n * E8;
const ist = (time: string) => new Date(`${time}+05:30`);

let pg: PGlite;
let db: Queryable;
beforeEach(async () => {
  ({ pg, db } = await testDb()); // bots 7 and 8
  await pg.exec(`
    insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash, is_house)
    values (90, '0x${"9".repeat(40)}', 'Steady Sam', 's', '', decode(repeat('00', 32), 'hex'), true),
           (91, '0x${"9".repeat(39)}1', 'Gold Granny', 'g', '', decode(repeat('00', 32), 'hex'), true)`);
  await pg.query("insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades) values (1, $1, $2, 'sprint', 8)", [
    ist("2026-11-26T00:00:00").toISOString(),
    ist("2026-11-28T21:30:00").toISOString(),
  ]);
}, 30_000);
afterEach(() => pg.close());

async function mark(botId: number, time: string, value: bigint, season = 1) {
  const slotTime = ist(time).toISOString();
  await pg.query("insert into slots (slot_time, kind, season_id) values ($1, 'scheduled', $2) on conflict do nothing", [slotTime, season]);
  const { rows } = await pg.query<{ id: string }>("select id::text as id from slots where slot_time = $1 and kind = 'scheduled'", [slotTime]);
  await pg.query("insert into portfolio_marks (bot_id, slot_id, cash_e8, holdings, value_e8) values ($1, $2, 0, '{}', $3)", [botId, rows[0]!.id, value.toString()]);
}

describe("season maths", () => {
  it("max drawdown is peak to trough, in bps of the peak", () => {
    expect(maxDrawdownBps([100n, 120n, 90n, 130n, 117n])).toBe(2500);
    expect(maxDrawdownBps([100n, 101n, 102n])).toBe(0);
  });

  it("daily returns use only the 21:00 marks, the first against the start", () => {
    const points = [
      { slotTime: ist("2026-11-26T13:00:00"), valueE8: 999n },
      { slotTime: ist("2026-11-26T21:00:00"), valueE8: 110n },
      { slotTime: ist("2026-11-27T21:00:00"), valueE8: 99n },
    ];
    expect(dailyReturns(100n, points)).toEqual([0.1, -0.1]);
  });

  it("Sortino as SPEC §8 defines it, with its floor and eligibility", () => {
    // mean 0.01, downside sqrt((0.02² + 0)/3)
    expect(sortino([0.03, -0.02, 0.02], 3)).toBeCloseTo(0.01 / Math.sqrt(0.0004 / 3), 5);
    expect(sortino([0.01, 0.01, 0.01], 3)).toBeCloseTo(0.01 / 0.001, 5); // no downside: the floor
    expect(sortino([0.01, 0.01], 9)).toBeNull(); // 2 daily returns
    expect(sortino([0.01, 0.01, 0.01], 2)).toBeNull(); // 2 trades
  });
});

describe("computeSeasonResults", () => {
  it("starts from the mark before the season, or the start cash for a bot that joined during it", async () => {
    await pg.query("insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades) values (0, '2026-11-23T18:30:00Z', '2026-11-25T16:00:00Z', 'sprint', 8)");
    await mark(7, "2026-11-25T21:00:00", 1100n * E8, 0); // S0's last mark
    await mark(7, "2026-11-26T09:00:00", 1210n * E8);
    await mark(8, "2026-11-27T09:00:00", 900n * E8);

    const results = await computeSeasonResults(db, 1, START);
    const of = (id: bigint) => results.find((r) => r.botId === id)!;
    expect(of(7n)).toMatchObject({ startValueE8: 1100n * E8, endValueE8: 1210n * E8, returnBps: 1000 });
    expect(of(8n)).toMatchObject({ startValueE8: START, endValueE8: 900n * E8, returnBps: -1000, maxDdBps: 1000 });
  });

  it("ranks each raised bot against the house bots, by return then drawdown", async () => {
    await mark(7, "2026-11-28T21:00:00", 1050n * E8); // +5 %
    await mark(8, "2026-11-28T21:00:00", 990n * E8); // -1 %
    await mark(90, "2026-11-28T21:00:00", 1020n * E8); // +2 %
    await mark(91, "2026-11-28T21:00:00", 1000n * E8); // 0 %

    const results = await computeSeasonResults(db, 1, START);
    const rank = (id: bigint) => results.find((r) => r.botId === id)!.battleRank;
    expect(rank(7n)).toBe(1);
    expect(rank(8n)).toBe(3);
    expect(rank(90n)).toBeNull();
    expect(rank(91n)).toBeNull();
  });

  it("leaves out bots with no mark in the season", async () => {
    await mark(7, "2026-11-28T21:00:00", 1000n * E8);
    expect((await computeSeasonResults(db, 1, START)).map((r) => r.botId)).toEqual([7n]);
  });
});
