import type { PGlite } from "@electric-sql/pglite";
import { zeroHash, type Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../src/scheduler/db";
import { checkIndexed, closeSeasons, type CloseChain, type CloseDeps } from "../../src/season/close";
import { computeTrustScores, scoresFile } from "../../src/trust/scores";
import { testDb } from "../decisions/helpers";

const E8 = 100_000_000n;
const START = 1000n * E8;
const ist = (time: string) => new Date(`${time}+05:30`);
const order = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

let pg: PGlite;
let db: Queryable;
let warnings: string[];

beforeEach(async () => {
  ({ pg, db } = await testDb()); // bots 7 and 8
  warnings = [];
  await pg.query(
    "insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades, trust_rules_version, status) values (1, $1, $2, 'sprint', 8, 'trust-v1-sprint', 'closing')",
    [ist("2026-11-26T00:00:00").toISOString(), ist("2026-11-28T21:30:00").toISOString()],
  );
}, 30_000);
afterEach(() => pg.close());

async function decision(time: string, gate: object, traded: Hex[] = [], season: number | null = 1): Promise<string> {
  const { rows: slots } = await pg.query<{ id: string }>(
    "insert into slots (slot_time, kind, season_id) values ($1, 'scheduled', $2) returning id::text as id",
    [ist(time).toISOString(), season],
  );
  const { rows } = await pg.query<{ id: string }>(
    `insert into decisions (bot_id, version, slot_id, prompt_version, model, input_json, input_hash, gate_result, reason, reason_tag, roast, status)
     values (7, 1, $1, 'p', 'm', '{}', decode(repeat('00', 32), 'hex'), $2, 'r', 'trend_up', '', 'executed') returning id::text as id`,
    [slots[0]!.id, JSON.stringify(gate)],
  );
  for (const [i, id] of traded.entries()) {
    await pg.query(
      `insert into trades (decision_id, action_index, order_id, bot_id, asset, side, cash_e8, units_e18, price_e8, round_id, tx_hash, log_index, block_number)
       values ($1, $2, decode($3, 'hex'), 7, 'BTC', 'BUY', 1, 1, 1, 1, $4, $2, 1)`,
      [rows[0]!.id, i, id.slice(2), `0x${"ab".repeat(32)}`],
    );
  }
  return rows[0]!.id;
}

function chain(overrides: Partial<CloseChain> = {}): CloseChain {
  return {
    isClosed: vi.fn(async () => false),
    closeSeason: vi.fn(async () => {}),
    startCashE8: vi.fn(async () => START),
    orderUsed: vi.fn(async () => false),
    scoresRoot: vi.fn(async () => zeroHash),
    rulesPublished: vi.fn(async () => true),
    commitScores: vi.fn(async () => {}),
    challenge: vi.fn(),
    settleChallenge: vi.fn(),
    expireChallenge: vi.fn(),
    ...overrides,
  } as CloseChain;
}

function deps(c: CloseChain): CloseDeps {
  return {
    db,
    chain: c,
    store: { put: vi.fn(), get: vi.fn() },
    contracts: { chainId: 1990, seasonLedger: `0x${"1".repeat(40)}`, paperLedger: `0x${"2".repeat(40)}`, fromBlock: "1" },
    log: { info() {}, warn: (event: string) => void warnings.push(event) },
    now: () => ist("2026-11-28T21:30:00"),
  };
}

describe("checkIndexed (#353)", () => {
  it("asks the chain only about the season's logged orders that have no indexed trade", async () => {
    await decision("2026-11-28T21:00:00", {
      orders: [{ orderId: order(1) }, { orderId: order(2) }],
      bigMoves: [{ orderId: order(3) }],
      retries: [{ result: { orders: [{ orderId: order(4) }] } }],
      shrinks: [{ orderId: order(3), order: { orderId: order(3) } }],
    }, [order(1)]);
    await decision("2026-11-29T09:00:00", { orders: [{ orderId: order(9) }] }, [], null); // not this season
    const c = chain();
    await checkIndexed(deps(c), 1);
    expect(vi.mocked(c.orderUsed).mock.calls.map(([id]) => id)).toEqual([order(2), order(3), order(4)]);
  });

  it("throws while an order used on-chain has no trade row", async () => {
    await decision("2026-11-28T21:00:00", { orders: [{ orderId: order(1) }, { orderId: order(2) }] }, [order(1)]);
    const c = chain({ orderUsed: vi.fn(async (id: Hex) => id === order(2)) });
    await expect(checkIndexed(deps(c), 1)).rejects.toThrow("1 executed orders aren't indexed yet");
    expect(warnings).toEqual(["season.trades_not_indexed"]);
  });

  it("stops the close before any chain write", async () => {
    await decision("2026-11-28T21:00:00", { orders: [{ orderId: order(5) }] });
    const c = chain({ orderUsed: vi.fn(async () => true) });
    await expect(closeSeasons(deps(c), new AbortController().signal)).rejects.toThrow("aren't indexed yet");
    expect(c.commitScores).not.toHaveBeenCalled();
    expect(c.closeSeason).not.toHaveBeenCalled();
    expect((await pg.query("select 1 from season_results")).rows).toHaveLength(0);
  });
});

describe("trust scores of a closed season (#354)", () => {
  beforeEach(async () => {
    await pg.query("update seasons set status = 'closed'"); // scores_root still null: picked again
    await decision("2026-11-28T21:00:00", { proposedActions: 0, orders: [] });
    await pg.query(
      `insert into portfolio_marks (bot_id, slot_id, cash_e8, holdings, value_e8) select 7, id, 0, '{}', $1 from slots`,
      [START.toString()],
    );
    await pg.query(
      "insert into season_results (season_id, bot_id, start_value_e8, end_value_e8, return_bps, max_dd_bps, trades) values (1, 7, 1, 1, 0, 0, 0)",
    );
  });

  it("keeps the DB rows when the chain's locked root differs", async () => {
    const c = chain({ isClosed: vi.fn(async () => true), scoresRoot: vi.fn(async () => `0x${"cd".repeat(32)}` as Hex) });
    await closeSeasons(deps(c), new AbortController().signal);
    expect(warnings).toContain("season.scores_locked");
    expect((await pg.query("select 1 from trust_scores")).rows).toHaveLength(0);
    expect(c.commitScores).not.toHaveBeenCalled();
  });

  it("saves the rows when they match the chain's root", async () => {
    const root = scoresFile(1, "trust-v1-sprint", await computeTrustScores(db, 1, START)).root;
    const c = chain({ isClosed: vi.fn(async () => true), scoresRoot: vi.fn(async () => root) });
    await closeSeasons(deps(c), new AbortController().signal);
    expect((await pg.query("select 1 from trust_scores where season_id = 1")).rows).toHaveLength(1);
    expect(c.commitScores).not.toHaveBeenCalled();
  });
});

describe("a near-empty season (#152: S0 has few trades)", () => {
  const memoryStore = () => {
    const files = new Map<string, string>();
    return { put: vi.fn(async (name: string, text: string) => (files.set(name, text), name)), get: vi.fn(async (uri: string) => files.get(uri) ?? "") };
  };

  it("closes a season with no bots: a root, no scores to commit", async () => {
    const c = chain();
    expect(await closeSeasons({ ...deps(c), store: memoryStore() }, new AbortController().signal)).toEqual([1]);
    expect(c.closeSeason).toHaveBeenCalledOnce();
    expect(c.commitScores).not.toHaveBeenCalled();
  });

  it("closes a season whose only bot never traded", async () => {
    const { rows } = await pg.query<{ id: string }>(
      "insert into slots (slot_time, kind, season_id) values ($1, 'scheduled', 1) returning id::text as id",
      [ist("2026-11-28T21:00:00").toISOString()],
    );
    await pg.query("insert into portfolio_marks (bot_id, slot_id, cash_e8, holdings, value_e8) values (7, $1, $2, '{}', $2)", [rows[0]!.id, START.toString()]);
    const c = chain();
    expect(await closeSeasons({ ...deps(c), store: memoryStore() }, new AbortController().signal)).toEqual([1]);
    expect(c.commitScores).toHaveBeenCalledOnce();
    expect(c.closeSeason).toHaveBeenCalledOnce();
    expect((await pg.query("select battle_rank, trades from season_results")).rows).toEqual([{ battle_rank: 1, trades: 0 }]);
  });
});
