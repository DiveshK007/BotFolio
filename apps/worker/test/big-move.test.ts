import { readFileSync } from "node:fs";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { loadBigMoveConfig } from "../src/config";
import { isBigMove } from "../src/gate/big-move";
import { gate } from "../src/gate/gate";
import { applyTrade, tradeAmounts } from "../src/gate/ledger-math";
import { shrinkBigMove, type ShrinkInput } from "../src/gate/shrink";
import type { GateInput } from "../src/gate/types";
import { APPROVED_ORDER_TYPES, ASSET_IDS, orderIdOf, paperLedgerDomain } from "../src/interfaces";
import { signApprovedOrder } from "../src/signing";
import {
  DECISION_ID,
  E8,
  NOW,
  buy,
  decision,
  gateInput,
  hold,
  liveStalePrices,
  portfolio,
  prices,
  seeded,
  sell,
} from "./helpers/fixtures";
import { executeBatch } from "./helpers/reference-ledger";

const SPEC = loadBigMoveConfig({}); // 30 % / 50 % / 2 h
const TWO_HOURS = 7200;

const input = (over: Parameters<typeof gateInput>[0] = {}) => gateInput({ bigMove: SPEC, ...over });
const run = (i: GateInput, ...actions: Parameters<typeof decision>) => gate(i, decision(...actions), "gate-test");

describe("gate() SPEC §6.4 step 9: big-move split, BUY", () => {
  it("pulls a BUY to ≥ 30 % out of the batch as an ApprovedOrder", () => {
    const r = run(input(), buy("GOLD", 35));
    expect(r.orders).toEqual([]);
    expect(r.bigMoves).toEqual([
      {
        order: {
          botId: 7n,
          asset: 4,
          buy: true,
          bps: 3500,
          decisionId: DECISION_ID,
          actionIndex: 0,
          deadline: BigInt(NOW + TWO_HOURS),
        },
        orderId: orderIdOf(DECISION_ID, 0),
        postWeightBps: 3500,
      },
    ]);
    expect(r.status).toBe("held");
  });

  it("exactly 30 % is big, 29 % is not", () => {
    expect(run(input(), buy("BTC", 30)).bigMoves).toHaveLength(1);
    expect(run(input(), buy("BTC", 29)).bigMoves).toEqual([]);
  });

  it("uses the post-trade weight, not the size of the trade", () => {
    const i = input({ portfolio: portfolio({ BTC: 25 }) });
    // 10 % of the 750 cash takes BTC from 25 % to 32.5 %.
    expect(run(i, buy("BTC", 10)).bigMoves[0]).toMatchObject({ postWeightBps: 3250 });
  });

  it("looks at the clipped order: a cap under 30 % means no big move", () => {
    const r = run(input({ bot: { maxPerCoinBps: 2500 } }), buy("BTC", 90));
    expect(r.bigMoves).toEqual([]);
    expect(r.orders[0]!.bps).toBe(2500);
  });

  it("is not a gate event (no F1 penalty)", () => {
    expect(run(input(), buy("GOLD", 35)).events).toEqual([]);
  });

  it("carries a clip through: 80 % asked, 40 % cap → a 40 % big move", () => {
    const r = run(input({ bot: { maxPerCoinBps: 4000 } }), buy("GOLD", 80));
    expect(r.bigMoves[0]!.order.bps).toBe(4000);
    expect(r.events).toMatchObject([{ kind: "clip", reason: "coin_cap" }]);
  });
});

describe("gate() SPEC §6.4 step 9: big-move split, SELL", () => {
  const holding = () => input({ portfolio: portfolio({ ETH: 20 }) });

  it("exactly 50 % of a holding is big, 49 % is not", () => {
    expect(run(holding(), sell("ETH", 50)).bigMoves[0]).toMatchObject({ order: { buy: false, bps: 5000, asset: 1 } });
    expect(run(holding(), sell("ETH", 49)).bigMoves).toEqual([]);
  });

  it("a full exit is big", () => {
    expect(run(holding(), sell("ETH", 100)).bigMoves[0]).toMatchObject({ order: { bps: 10000 }, postWeightBps: 0 });
  });
});

describe("gate() SPEC §6.4 step 9: next to the rest of the decision", () => {
  it("only removes the big one and keeps the other actions' indexes", () => {
    const r = run(input(), hold("SOL"), buy("GOLD", 40), buy("BTC", 10));
    expect(r.bigMoves[0]!.order.actionIndex).toBe(1);
    expect(r.orders.map((o) => o.actionIndex)).toEqual([2]);
    expect(r.orders[0]!.orderId).not.toBe(r.bigMoves[0]!.orderId);
    expect(r.status).toBe("executed");
  });

  it("a pending big BUY does not spend cash in the batch", () => {
    const i = input();
    const r = run(i, buy("GOLD", 40), buy("BTC", 20));
    const after = executeBatch(i.bot, i.portfolio, i.prices, r.orders);
    expect(after.portfolio.cashE8).toBe(800n * E8);
  });

  it("a pending big SELL does not fund a later BUY", () => {
    const r = run(input({ portfolio: portfolio({ BTC: 100 }) }), sell("BTC", 60), buy("ETH", 20));
    expect(r.bigMoves).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ actionIndex: 1, reason: "low_cash" });
  });

  it("re-clips a big BUY to the room the batch leaves", () => {
    const i = input();
    const r = run(i, buy("GOLD", 40), buy("GOLD", 20));
    // Batch puts 20 % in Gold, so 30 % of room is left: 3750 bps of the 800 cash.
    expect(r.bigMoves[0]!.order.bps).toBe(3750);
    const after = executeBatch(i.bot, i.portfolio, i.prices, [...r.orders, r.bigMoves[0]!.order]);
    expect(after.skips).toEqual([]);
  });

  it("re-clips when a batch SELL raises the cash a big BUY is a share of", () => {
    const i = input({ portfolio: portfolio({ ETH: 40 }) });
    const r = run(i, buy("GOLD", 80), sell("ETH", 40));
    const after = executeBatch(i.bot, i.portfolio, i.prices, [...r.orders, r.bigMoves[0]!.order]);
    expect(after.skips).toEqual([]);
    expect(r.bigMoves[0]!.postWeightBps).toBeLessThanOrEqual(5000);
  });

  it("reserves a trade for each big move", () => {
    const r = run(input({ bot: { maxTradesPerDay: 2 } }), buy("GOLD", 40), buy("BTC", 10), buy("ETH", 10));
    expect(r.bigMoves).toHaveLength(1);
    expect(r.orders).toHaveLength(1);
    expect(r.events).toMatchObject([{ actionIndex: 2, reason: "trade_limit" }]);
  });

  it("reads the thresholds and the TTL from env", () => {
    const bigMove = loadBigMoveConfig({ BIG_MOVE_BUY_WEIGHT_BPS: "2000", BIG_MOVE_SELL_BPS: "2500", BIG_MOVE_TTL_MIN: "30" });
    const r = run(input({ bigMove, portfolio: portfolio({ ETH: 20 }) }), buy("BTC", 25), sell("ETH", 25));
    expect(r.bigMoves.map((m) => m.order.deadline)).toEqual([BigInt(NOW + 1800), BigInt(NOW + 1800)]);
  });

  it("only BTC and ETH fresh: a stale big move is dropped, a fresh one still asks", () => {
    const r = run(input({ prices: liveStalePrices() }), buy("GOLD", 40), buy("BTC", 40), buy("ETH", 10));
    expect(r.bigMoves.map((m) => m.order.asset)).toEqual([0]);
    expect(r.orders.map((o) => o.asset)).toEqual([1]);
    expect(r.events).toMatchObject([{ asset: "GOLD", reason: "stale", countsForF1: false }]);
  });
});

describe("gate() SPEC §6.4 step 9: house bots", () => {
  it.each([
    ["BUY to 50 %", {}, buy("GOLD", 50)],
    ["full SELL", { portfolio: portfolio({ GOLD: 40 }) }, sell("GOLD", 100)],
  ])("%s executes directly, never a big move", (_name, over, { asset, action, pct }) => {
    const output = { ...decision(), actions: [{ asset, action, bps: pct * 100 }] };
    const r = gate(input({ ...over, bot: { isHouse: true } }), output, "gate-test");
    expect(r.bigMoves).toEqual([]);
    expect(r.orders).toHaveLength(1);
  });
});

describe("shrinkBigMove() SPEC §6.4 step 10: expiry fallback", () => {
  const LATE = NOW + TWO_HOURS + 1;

  function pendingFrom(i: GateInput, ...actions: Parameters<typeof decision>): ShrinkInput {
    return {
      ...i,
      pending: run(i, ...actions).bigMoves[0]!.order,
      nowSeconds: LATE,
      orderUsed: false,
      trigger: "expired",
    };
  }
  const goldBuy = () => pendingFrom(input(), hold("BTC"), buy("GOLD", 45));

  it("shrinks a BUY to just under 30 % with the SAME orderId", () => {
    const r = shrinkBigMove(goldBuy());
    if (r.outcome !== "execute") throw new Error(r.outcome);
    expect(r.order).toEqual({
      botId: 7n,
      asset: 4,
      buy: true,
      bps: 2999,
      decisionId: DECISION_ID,
      actionIndex: 1,
      orderId: orderIdOf(DECISION_ID, 1),
    });
    expect(r.tradesTodayAfter).toBe(1);
  });

  it("the shrunk order has the orderId the owner was asked to approve", () => {
    const i = input();
    const asked = run(i, buy("GOLD", 45)).bigMoves[0]!;
    const r = shrinkBigMove(pendingFrom(i, buy("GOLD", 45)));
    if (r.outcome !== "execute") throw new Error(r.outcome);
    expect(r.order.orderId).toBe(asked.orderId);
    // Both paths share usedOrder, so the second one is a no-op.
    const { skips } = executeBatch(i.bot, i.portfolio, i.prices, [asked.order, r.order]);
    expect(skips).toEqual([{ actionIndex: 0, reason: "USED" }]);
  });

  it("shrinks a SELL to just under 50 % of the holding", () => {
    const r = shrinkBigMove(pendingFrom(input({ portfolio: portfolio({ ETH: 20 }) }), sell("ETH", 100)));
    expect(r).toMatchObject({ outcome: "execute", order: { bps: 4999, buy: false } });
  });

  it("counts what is already held", () => {
    const r = shrinkBigMove(pendingFrom(input({ portfolio: portfolio({ BTC: 20 }) }), buy("BTC", 30)));
    // Just under 100 of room in 800 cash.
    expect(r).toMatchObject({ outcome: "execute", order: { bps: 1249 } });
  });

  it("drops it when the holding is already at the threshold", () => {
    const r = shrinkBigMove(pendingFrom(input({ portfolio: portfolio({ BTC: 35 }) }), buy("BTC", 10)));
    expect(r).toEqual({ outcome: "drop", reason: "zero" });
  });

  it("never grows past what was asked", () => {
    const s = goldBuy();
    expect(shrinkBigMove({ ...s, pending: { ...s.pending, bps: 1200 } })).toMatchObject({ order: { bps: 1200 } });
  });

  it("re-checks the per-coin cap as it is now", () => {
    const s = goldBuy();
    const r = shrinkBigMove({ ...s, bot: { ...s.bot, maxPerCoinBps: 2000 } });
    expect(r).toMatchObject({ outcome: "execute", order: { bps: 2000 } });
  });

  it("re-checks trades per day", () => {
    const s = goldBuy();
    expect(shrinkBigMove({ ...s, bot: { ...s.bot, tradesToday: 8 } })).toEqual({ outcome: "drop", reason: "trade_limit" });
  });

  it("re-checks the bot is active", () => {
    const s = goldBuy();
    expect(shrinkBigMove({ ...s, bot: { ...s.bot, active: false } })).toEqual({ outcome: "drop", reason: "inactive" });
  });

  it("re-checks freshness", () => {
    expect(shrinkBigMove({ ...goldBuy(), prices: liveStalePrices() })).toEqual({ outcome: "stale" });
    expect(shrinkBigMove({ ...goldBuy(), prices: prices(["GOLD"]) })).toMatchObject({ outcome: "execute" });
  });

  it("waits while the owner can still approve (deadline inclusive)", () => {
    expect(shrinkBigMove({ ...goldBuy(), nowSeconds: NOW + TWO_HOURS })).toEqual({ outcome: "not_due" });
  });

  it("owner tapped Shrink: no waiting", () => {
    expect(shrinkBigMove({ ...goldBuy(), nowSeconds: NOW + 60, trigger: "owner" })).toMatchObject({ outcome: "execute" });
  });

  it("sends nothing if the approval already executed", () => {
    expect(shrinkBigMove({ ...goldBuy(), orderUsed: true })).toEqual({ outcome: "already_executed" });
  });

  it("chains several shrinks for one bot", () => {
    const i = input();
    const moves = run(i, buy("GOLD", 40), buy("BTC", 40)).bigMoves;
    const base = { ...i, nowSeconds: LATE, orderUsed: false, trigger: "expired" as const };
    const a = shrinkBigMove({ ...base, pending: moves[0]!.order });
    if (a.outcome !== "execute") throw new Error(a.outcome);
    const b = shrinkBigMove({
      ...base,
      pending: moves[1]!.order,
      portfolio: a.portfolioAfter,
      bot: { ...i.bot, tradesToday: a.tradesTodayAfter },
    });
    if (b.outcome !== "execute") throw new Error(b.outcome);
    expect(executeBatch(i.bot, i.portfolio, i.prices, [a.order, b.order]).skips).toEqual([]);
  });
});

describe("big moves over 3,000 random decisions", () => {
  it("batch has none, every one can be approved, every shrink lands under the threshold", () => {
    const rnd = seeded(44);
    let seen = 0;
    for (let n = 0; n < 3000; n++) {
      const i = input({
        portfolio: portfolio({ BTC: rnd(34), ETH: rnd(34), GOLD: rnd(33) }),
        bot: { maxPerCoinBps: 1000 + 500 * rnd(9) },
      });
      const r = run(i, ...Array.from({ length: 1 + rnd(3) }, () => (rnd(2) ? buy : sell)(ASSET_IDS[rnd(5)]!, rnd(101))));

      let sim = i.portfolio;
      for (const o of r.orders) {
        const trade = { asset: ASSET_IDS[o.asset]!, buy: o.buy, bps: o.bps };
        expect(isBigMove(i, sim, trade)).toBe(false);
        sim = applyTrade(sim, i.prices, trade);
      }
      for (const { order } of r.bigMoves) {
        seen++;
        expect(executeBatch(i.bot, i.portfolio, i.prices, [...r.orders, order]).skips).toEqual([]);

        const bot = { ...i.bot, tradesToday: r.orders.length };
        const s = shrinkBigMove({ ...i, bot, portfolio: sim, pending: order, orderUsed: false, trigger: "owner" });
        if (s.outcome !== "execute") continue;
        const trade = { asset: ASSET_IDS[order.asset]!, buy: order.buy, bps: s.order.bps };
        expect(isBigMove(i, sim, trade)).toBe(false);
        expect(tradeAmounts(sim, i.prices, trade).cashE8).toBeGreaterThan(0n);
        expect(executeBatch(bot, sim, i.prices, [s.order]).skips).toEqual([]);
      }
    }
    expect(seen).toBeGreaterThan(500);
  });
});

describe("signApprovedOrder()", () => {
  it("uses the EIP-712 type in IPaperLedger", () => {
    const sol = readFileSync(new URL("../../../packages/contracts/src/interfaces/IPaperLedger.sol", import.meta.url), "utf8");
    const fields = APPROVED_ORDER_TYPES.ApprovedOrder.map((f) => `${f.type} ${f.name}`).join(",");
    expect(sol).toContain(`\`ApprovedOrder(${fields})\``);
  });

  it("recovers to the runner over this exact order and no other", async () => {
    const runner = privateKeyToAccount(generatePrivateKey()); // throwaway, made in memory
    const ledger = "0x00000000000000000000000000000000000000a1";
    const message = run(input(), buy("GOLD", 35)).bigMoves[0]!.order;
    const signature = await signApprovedOrder(runner, ledger, message);
    const recover = (m: typeof message) =>
      recoverTypedDataAddress({
        domain: paperLedgerDomain(ledger),
        types: APPROVED_ORDER_TYPES,
        primaryType: "ApprovedOrder",
        message: m,
        signature,
      });
    expect(await recover(message)).toBe(runner.address);
    expect(await recover({ ...message, bps: 5000 })).not.toBe(runner.address);
  });
});
