import { decisionIdFromUuid, orderIdOf } from "@botfolio/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { STALE_GIVE_UP_SECONDS, sweepBigMoves } from "../../src/big-moves/sweep";
import { canonicalJson, hashJson } from "../../src/canonical";
import { publicJson } from "../../src/decisions/json";
import { storeGateInput } from "../../src/decisions/replay";
import type { Portfolio } from "../../src/gate/types";
import { verifyOffline } from "../../src/season/verify";
import type { RunnerDeps } from "../../src/slot/deps";
import type { RunnerChain } from "../../src/slot/chain";
import { createTestDb, type TestDb } from "../indexer/helpers/db";

const BIG_MOVE = { buyWeightBps: 3000, sellBps: 5000, ttlMs: 7_200_000 };

// The paths the fork test can't reach cheaply: stale prices and giving up.
function deps(opts: { fresh: boolean; chainNow: number; deadline: number }) {
  const updates: unknown[][] = [];
  const db = {
    async query<Row extends object>(sql: string, params: unknown[] = []) {
      if (sql.includes("where m.status = 'pending'")) {
        return {
          rows: [
            { id: "1", decision: "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab", bot_id: "7", asset: "SOL", side: "BUY", bps: 4500, action_index: 0, order_id: `0x${"ab".repeat(32)}`, deadline: String(opts.deadline), start_units: null },
          ] as unknown as Row[],
        };
      }
      if (sql.startsWith("update big_moves")) updates.push(params);
      return { rows: [] as Row[] };
    },
  };
  const chain: Partial<RunnerChain> = {
    chainSeconds: async () => opts.chainNow,
    orderUsed: async () => false,
    executeBatch: vi.fn(async () => "0x" as const),
    state: async () => ({
      bot: { active: true, house: false, maxPerCoinBps: 5000, maxTradesPerDay: 8 } as never,
      portfolio: { cashE8: 100_000_000_000n, unitsE18: { BTC: 0n, ETH: 0n, SOL: 0n, XRP: 0n, GOLD: 0n } },
      tradesToday: 0,
    }),
  };
  const readings = ["BTC", "ETH", "SOL", "XRP", "GOLD"].map((asset) => ({
    asset, feed: "0x0", roundId: "1", priceE8: "7000000000", updatedAt: opts.chainNow, ageSeconds: 0, maxAgeSeconds: 1800, valid: true, fresh: asset !== "SOL" || opts.fresh,
  }));
  const d = {
    db,
    chain,
    readPrices: async () => readings,
    bigMove: { buyWeightBps: 3000, sellBps: 5000, ttlMs: 7_200_000 },
    log: { info() {}, warn() {} },
    now: () => new Date(opts.chainNow * 1000),
  } as unknown as RunnerDeps;
  return { d, updates, chain };
}

describe("sweepBigMoves when the price is too old", () => {
  it("leaves it pending for the next sweeps", async () => {
    const { d, updates, chain } = deps({ fresh: false, chainNow: 10_000, deadline: 9_000 });
    expect(await sweepBigMoves(d, new AbortController().signal)).toEqual({ shrunk: 0, expired: 0 });
    expect(updates).toEqual([]);
    expect(chain.executeBatch).not.toHaveBeenCalled();
  });

  it("gives up and holds after the retry window", async () => {
    const { d, updates } = deps({ fresh: false, chainNow: 9_000 + STALE_GIVE_UP_SECONDS + 1, deadline: 9_000 });
    expect(await sweepBigMoves(d, new AbortController().signal)).toEqual({ shrunk: 0, expired: 1 });
    expect(updates).toEqual([["1", "expired"]]);
  });
});

// #346 / #347 on the real schema: what the sweep logs in gate_result.shrinks, and that a replay recomputes it.
describe("sweepBigMoves logging, on PGlite", () => {
  const ZERO = `\\x${"00".repeat(32)}`;
  const E8 = 100_000_000n;
  const E18 = 10n ** 18n;
  const ASSETS = ["BTC", "ETH", "SOL", "XRP", "GOLD"] as const;
  type Asset = (typeof ASSETS)[number];
  const units = (over: Partial<Record<Asset, bigint>>) => Object.fromEntries(ASSETS.map((a) => [a, over[a] ?? 0n])) as Record<Asset, bigint>;
  const ID = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
  const NOW = 10_000;
  let db: TestDb;
  let price: Record<Asset, bigint>;
  let held: Portfolio;
  let sent: number[][];
  let failSend: boolean;

  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(() => db.close());

  beforeEach(async () => {
    await db.reset();
    price = units({ BTC: 70n * E8, ETH: 70n * E8, SOL: 70n * E8, XRP: 70n * E8, GOLD: 70n * E8 });
    sent = [];
    failSend = false;
    await db.query("insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash) values (7, $1, 'b', 'b', 'p', $2)", [
      `0x${"a1".repeat(20)}`,
      ZERO,
    ]);
    await db.query(
      `insert into bot_versions (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source)
       values (7, 1, 'r', 5000, 8, '{}', $1, 'create')`,
      [ZERO],
    );
  });

  /** A decision whose first gate started from `start`, with one pending big move past its deadline. */
  async function pendingMove(side: "BUY" | "SELL", asset: Asset, bps: number, start: Portfolio, retryStart?: Portfolio) {
    const { rows: slot } = await db.query<{ id: string }>("insert into slots (slot_time, kind) values (now(), 'scheduled') returning id::text as id");
    const decisionId = decisionIdFromUuid(ID);
    const orderId = orderIdOf(decisionId, 1);
    const stored = (portfolio: Portfolio) =>
      storeGateInput({
        decisionId,
        nowSeconds: NOW - 7300,
        bot: { botId: 7n, active: true, isHouse: false, maxPerCoinBps: 5000, maxTradesPerDay: 8, tradesToday: 0 },
        portfolio,
        prices: Object.fromEntries(ASSETS.map((a) => [a, { priceE8: price[a], fresh: true }])) as never,
        bigMove: BIG_MOVE,
      });
    const gateResult = {
      rulesVersion: "gate-test",
      replay: { input: stored(start) },
      ...(retryStart ? { retries: [{ attempt: 1, indexes: [1], input: stored(retryStart), result: { bigMoves: [{ orderId }] } }] } : {}),
    };
    await db.query(
      `insert into decisions (id, bot_id, version, slot_id, prompt_version, model, input_json, input_hash, gate_result, status)
       values ($1, 7, 1, $2, 'p', 'm', '{}', $3, $4::jsonb, 'executed')`,
      [ID, slot[0]!.id, ZERO, JSON.stringify(publicJson(gateResult))],
    );
    await db.query(
      `insert into big_moves (decision_id, action_index, order_id, bot_id, asset, side, bps, runner_sig, deadline)
       values ($1, 1, decode($2, 'hex'), 7, $3, $4, $5, '\\x00', to_timestamp($6))`,
      [ID, orderId.slice(2), asset, side, bps, NOW - 100],
    );
  }

  async function sweep() {
    const chain: Partial<RunnerChain> = {
      chainSeconds: async () => NOW,
      orderUsed: async () => false,
      executeBatch: async (batch) => {
        sent.push(batch.map((o) => o.bps));
        if (failSend) throw new Error("rpc down");
        return "0x";
      },
      state: async () => ({ bot: { active: true, house: false, maxPerCoinBps: 5000, maxTradesPerDay: 8 } as never, portfolio: held, tradesToday: 1 }),
    };
    const readings = ASSETS.map((asset) => ({
      asset, feed: "0x0", roundId: "1", priceE8: price[asset], updatedAt: NOW, ageSeconds: 0, maxAgeSeconds: 1800, valid: true, fresh: true,
    }));
    const deps = { db, chain, readPrices: async () => readings, bigMove: BIG_MOVE, log: { info() {}, warn() {} }, now: () => new Date(NOW * 1000) };
    await sweepBigMoves(deps as unknown as RunnerDeps, new AbortController().signal);
  }

  type Logged = { shrinks: { pending: { startUnitsE18?: string }; order: { bps: number } }[] };
  async function gateResult(): Promise<Logged> {
    const { rows } = await db.query<{ g: Logged }>("select gate_result as g from decisions where id = $1::uuid", [ID]);
    return rows[0]!.g;
  }

  /** verify.ts on a one-decision file. Only its shrink check matters here: the fixture's gate result is hand-made. */
  function shrinkFindings(g: unknown) {
    const line = { type: "decision", id: ID, bot_id: "7", input: {}, input_hash: hashJson({}), raw_output: null, output_hash: null, gate_result: g, trades: [] };
    return verifyOffline(`${canonicalJson({ type: "season" })}\n${canonicalJson(line)}\n`).findings.filter((f) => f.what.includes("shrink"));
  }

  it("caps a cumulative SELL against the decision's starting holding, logs that holding, and replays it", async () => {
    // Started with 4 ETH and sold 40 % in the batch: 2.4 left. 40 % of that more would be 64 % in total.
    await pendingMove("SELL", "ETH", 4000, { cashE8: 100n * E8, unitsE18: units({ ETH: 4n * E18 }) });
    held = { cashE8: 212n * E8, unitsE18: units({ ETH: (24n * E18) / 10n }) };
    await sweep();

    expect(sent).toEqual([[1665]]); // 49.99 % of 4 less the 1.6 sold, as a share of 2.4
    const g = await gateResult();
    expect(g.shrinks).toHaveLength(1);
    expect(g.shrinks[0]!.pending.startUnitsE18).toBe((4n * E18).toString());
    expect(shrinkFindings(g)).toEqual([]);

    // Without the logged start a replay gets 4000, so the field is what makes the shrink recomputable.
    const { startUnitsE18: _, ...before347 } = g.shrinks[0]!.pending;
    expect(shrinkFindings({ ...g, shrinks: [{ ...g.shrinks[0]!, pending: before347 }] })).toHaveLength(1);
  });

  it("takes the start from the stale retry that made the big move", async () => {
    await pendingMove("SELL", "ETH", 4000, { cashE8: 100n * E8, unitsE18: units({ ETH: 4n * E18 }) }, { cashE8: 142n * E8, unitsE18: units({ ETH: 3n * E18 }) });
    held = { cashE8: 184n * E8, unitsE18: units({ ETH: (24n * E18) / 10n }) };
    await sweep();
    expect(sent).toEqual([[3748]]); // 49.99 % of 3 less the 0.6 sold, as a share of 2.4
  });

  it("a re-shrink after a send that didn't land replaces the logged entry with the order sent", async () => {
    held = { cashE8: 930n * E8, unitsE18: units({ GOLD: E18 }) };
    await pendingMove("BUY", "GOLD", 4500, held);
    failSend = true;
    await sweep();
    expect((await gateResult()).shrinks).toHaveLength(1);
    expect((await gateResult()).shrinks[0]!.pending.startUnitsE18).toBeUndefined();

    price.GOLD = 100n * E8; // the room under 30 % moves with the price
    failSend = false;
    await sweep();
    expect(sent).toHaveLength(2);
    expect(sent[1]![0]).not.toBe(sent[0]![0]);
    const g = await gateResult();
    expect(g.shrinks).toHaveLength(1);
    expect(g.shrinks[0]!.order.bps).toBe(sent[1]![0]);
    expect(shrinkFindings(g)).toEqual([]);
  });
});
