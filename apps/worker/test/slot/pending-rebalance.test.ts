import type { AssetId } from "@botfolio/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadBigMoveConfig } from "../../src/config";
import { gate } from "../../src/gate/gate";
import { houseDecision, type HouseContext, type HouseStrategy } from "../../src/house/strategies";
import type { Slot } from "../../src/scheduler/slots";
import { pendingRebalanceOf } from "../../src/slot/bots";
import { gateInput, liveStalePrices, portfolio, prices } from "../helpers/fixtures";
import { createTestDb, type TestDb } from "../indexer/helpers/db";

// #219 item 19: a house rebalance left on a stale price is tried again at the season's later slots.
const ist = (time: string) => new Date(`${time}:00+05:30`);
const ZERO = `\\x${"00".repeat(32)}`;
const SEASON = { id: 0, startsAt: ist("2026-11-27T00:00") };

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
}, 30_000);
afterAll(() => db.close());

beforeEach(async () => {
  await db.reset();
  await db.query(
    `insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades) values (0, $1, $2, 'sprint', 8)`,
    [SEASON.startsAt, ist("2026-11-28T21:30")],
  );
  await db.query(
    "insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash, is_house) values (1, $1, 'Gold Granny', 'g', '', $2, true)",
    [`0x${"11".repeat(20)}`, ZERO],
  );
  await db.query(
    `insert into bot_versions (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source)
     values (1, 1, '', 5000, 8, '{}', $1, 'create')`,
    [ZERO],
  );
});

const slot = (time: string, kind: Slot["kind"] = "scheduled"): Slot => ({ id: "0", kind, time: ist(time), season: SEASON });

/** Decide and store the way the runner does, with only the columns pendingRebalanceOf reads. */
async function decide(strategy: HouseStrategy, at: Slot, fresh: boolean): Promise<HouseContext> {
  const ctx: HouseContext = {
    strategy,
    slot: at,
    seasonStart: SEASON.startsAt,
    portfolio: portfolio(),
    prices: fresh ? prices() : liveStalePrices(),
    chg24hPct: {},
    pendingRebalance: await pendingRebalanceOf(db, 1n, at),
  };
  const output = houseDecision(ctx);
  const result = gate(
    gateInput({ bot: { isHouse: true, maxPerCoinBps: 5000, maxTradesPerDay: 8 }, portfolio: ctx.portfolio, prices: ctx.prices, bigMove: loadBigMoveConfig({}) }),
    output,
    "gate-test",
  );
  const { rows } = await db.query<{ id: string }>(
    "insert into slots (slot_time, kind, season_id) values ($1, $2, 0) returning id::text as id",
    [at.time, at.kind],
  );
  const input = { strategy, slot: { kind: at.kind, time: at.time.toISOString() }, seasonStart: SEASON.startsAt.toISOString(), pendingRebalance: ctx.pendingRebalance };
  await db.query(
    `insert into decisions (bot_id, version, slot_id, prompt_version, model, input_json, input_hash, raw_output_json, gate_result, status)
     values (1, 1, $1, 'house-rules-v1', 'house-rules', $2, $3, $4, $5, $6)`,
    [rows[0]!.id, JSON.stringify(input), ZERO, JSON.stringify(output), JSON.stringify({ events: result.events }), result.status],
  );
  return ctx;
}

describe("pendingRebalanceOf", () => {
  it("Granny's Gold, stale at 09:00, is retried at 13:00 and again at 17:00 until it trades, then never", async () => {
    expect((await decide("gold_granny", slot("2026-11-27T09:00"), false)).pendingRebalance).toEqual([]);
    const one = await decide("gold_granny", slot("2026-11-27T13:00"), false);
    expect(one.pendingRebalance).toEqual<AssetId[]>(["GOLD"]);
    const five = await decide("gold_granny", slot("2026-11-27T17:00"), true);
    expect(five.pendingRebalance).toEqual<AssetId[]>(["GOLD"]);
    expect(houseDecision(five).actions).toEqual([{ asset: "GOLD", action: "BUY", bps: 5000 }]);
    expect((await decide("gold_granny", slot("2026-11-27T21:00"), true)).pendingRebalance).toEqual([]);
  });

  it("a rebalance that traded leaves nothing pending", async () => {
    await decide("gold_granny", slot("2026-11-27T09:00"), true);
    expect(await pendingRebalanceOf(db, 1n, slot("2026-11-27T13:00"))).toEqual([]);
  });

  it("only within the same season, and never for a debut or Momentum Max", async () => {
    await decide("gold_granny", slot("2026-11-27T09:00"), false);
    expect(await pendingRebalanceOf(db, 1n, { ...slot("2026-11-29T09:00"), season: { id: 1, startsAt: ist("2026-11-29T00:00") } })).toEqual([]);
    expect(await pendingRebalanceOf(db, 1n, slot("2026-11-27T10:00", "debut"))).toEqual([]);
    await db.query("update decisions set input_json = jsonb_set(input_json, '{strategy}', '\"momentum_max\"')");
    expect(await pendingRebalanceOf(db, 1n, slot("2026-11-27T13:00"))).toEqual([]);
  });
});
