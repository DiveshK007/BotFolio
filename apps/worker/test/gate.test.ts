import { readFileSync } from "node:fs";
import { encodeAbiParameters, keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import { DECISION_SCHEMA } from "../src/decision/schema";
import { gate } from "../src/gate/gate";
import { portfolioValueE8, positionValueE8, tradesTodayFrom } from "../src/gate/ledger-math";
import { LEDGER_EQUIVALENT, type GateInput } from "../src/gate/types";
import { istDay, SKIP_REASONS, type LedgerOrder } from "../src/interfaces";
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

const RULES = "gate-test";
const run = (input: GateInput, ...actions: Parameters<typeof decision>) => gate(input, decision(...actions), RULES);

describe("gate() SPEC §6.4 step 1: schema", () => {
  it.each([
    ["not an object", "buy everything"],
    ["null", null],
    ["missing fields", { actions: [] }],
    ["4 actions", decision(buy("BTC", 5), buy("ETH", 5), buy("SOL", 5), buy("XRP", 5))],
    ["unknown asset", { ...decision(), actions: [{ asset: "DOGE", action: "BUY", pct: 5 }] }],
    ["pct over 100", decision(buy("BTC", 101))],
    ["fractional pct", decision(buy("BTC", 2.5))],
    ["reason too short", { ...decision(), reason: "yolo" }],
    ["extra key", { ...decision(), max_per_coin_pct: 100 }],
  ])("%s → invalid, hold", (_name, output) => {
    const r = gate(gateInput(), output, RULES);
    expect(r.status).toBe("invalid");
    expect(r.orders).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("accepts the optional daily_call", () => {
    expect(gate(gateInput(), { ...decision(), daily_call: { btc_up: true, why: "Momentum" } }, RULES).status).toBe("held");
  });

  it("uses exactly the SPEC §6.3 schema", () => {
    const spec = readFileSync(new URL("../../../SPEC.md", import.meta.url), "utf8");
    const block = /### 6\.3[^\n]*\n```json\n([\s\S]*?)```/.exec(spec)![1]!;
    expect(DECISION_SCHEMA).toEqual(JSON.parse(block));
  });
});

describe("gate() SPEC §6.4 step 2: stale assets", () => {
  it("drops the stale action and keeps the others", () => {
    const r = run(gateInput({ prices: prices(["BTC"]) }), buy("GOLD", 20), buy("BTC", 20));
    expect(r.status).toBe("executed");
    expect(r.orders.map((o) => [o.asset, o.actionIndex])).toEqual([[0, 1]]);
    expect(r.events).toEqual([
      { actionIndex: 0, asset: "GOLD", action: "BUY", kind: "drop", reason: "stale", countsForF1: false },
    ]);
  });

  it("is skipped_stale when stale prices are the only reason nothing trades", () => {
    expect(run(gateInput({ prices: prices([]) }), buy("GOLD", 20)).status).toBe("skipped_stale");
  });

  it("is held, not skipped_stale, when another reason also applies", () => {
    expect(run(gateInput({ prices: prices(["BTC"]) }), buy("GOLD", 20), sell("BTC", 20)).status).toBe("held");
  });

  it("treats a non-positive answer as stale, like the contract", () => {
    const input = gateInput({ prices: { ...prices(), BTC: { priceE8: 0n, fresh: true } } });
    expect(run(input, buy("BTC", 10)).events[0]).toMatchObject({ reason: "stale" });
  });

  describe("only BTC and ETH fresh (live Nov 22 13:13 IST)", () => {
    const stale = liveStalePrices();

    it("derives exactly that from the feed ages", () => {
      expect(Object.entries(stale).filter(([, p]) => p.fresh).map(([a]) => a)).toEqual(["BTC", "ETH"]);
    });

    it("trades BTC and ETH and keeps their original action indexes", () => {
      const r = run(gateInput({ prices: stale }), buy("GOLD", 25), buy("BTC", 20), buy("ETH", 20));
      expect(r.orders.map((o) => [o.asset, o.actionIndex])).toEqual([[0, 1], [1, 2]]);
      expect(r.events).toHaveLength(1);
    });

    it("holds without any F1 penalty when the bot only wanted SOL, XRP and Gold", () => {
      const r = run(gateInput({ prices: stale }), buy("SOL", 20), buy("XRP", 20), buy("GOLD", 20));
      expect(r.status).toBe("skipped_stale");
      expect(r.events.every((e) => !e.countsForF1)).toBe(true);
    });

    it("does not let a stale SELL fund a later BUY", () => {
      const input = gateInput({ prices: stale, portfolio: portfolio({ GOLD: 100 }) });
      const r = run(input, sell("GOLD", 40), buy("BTC", 100));
      expect(r.orders).toEqual([]);
      expect(r.events.map((e) => e.reason)).toEqual(["stale", "low_cash"]);
    });

    it("still values stale holdings at their last answer for the per-coin cap", () => {
      const input = gateInput({ prices: stale, portfolio: portfolio({ GOLD: 50 }), bot: { maxPerCoinBps: 2500 } });
      // Cap = 25 % of the whole 1000 = 250, which is half of the 500 cash.
      expect(run(input, buy("BTC", 100)).orders[0]!.bps).toBe(5000);
    });
  });
});

describe("gate() SPEC §6.4 step 3: nothing to sell, no cash to buy", () => {
  it("drops a SELL with no holding", () => {
    expect(run(gateInput(), sell("SOL", 50)).events[0]).toMatchObject({ kind: "drop", reason: "no_holding", countsForF1: true });
  });

  it("drops a BUY with cash under 1 % of the portfolio", () => {
    const p = portfolio({ BTC: 99 });
    const input = gateInput({ portfolio: { ...p, cashE8: p.cashE8 - 1n * E8 } });
    expect(run(input, buy("ETH", 100)).events[0]).toMatchObject({ reason: "low_cash" });
  });

  it("drops a BUY with no cash at all", () => {
    expect(run(gateInput({ portfolio: portfolio({ BTC: 100 }) }), buy("ETH", 50)).events[0]).toMatchObject({ reason: "low_cash" });
  });
});

describe("gate() SPEC §6.4 step 4: trades per day", () => {
  it("clips the slot to the trades left today", () => {
    const r = run(gateInput({ bot: { maxTradesPerDay: 4, tradesToday: 2 } }), buy("BTC", 10), buy("ETH", 10), buy("SOL", 10));
    expect(r.orders.map((o) => o.actionIndex)).toEqual([0, 1]);
    expect(r.events[0]).toMatchObject({ actionIndex: 2, reason: "trade_limit", countsForF1: true });
  });

  it("holds when the bot is already at or over its limit", () => {
    expect(run(gateInput({ bot: { maxTradesPerDay: 2, tradesToday: 3 } }), buy("BTC", 10)).status).toBe("held");
  });

  it("does not spend a trade on a dropped action", () => {
    const r = run(gateInput({ bot: { maxTradesPerDay: 1 } }), sell("SOL", 50), buy("BTC", 10));
    expect(r.orders.map((o) => o.actionIndex)).toEqual([1]);
  });

  it("resets the on-chain counter on a new IST day", () => {
    const today = istDay(NOW);
    expect(tradesTodayFrom({ lastDay: today, tradesToday: 3 }, NOW)).toBe(3);
    expect(tradesTodayFrom({ lastDay: today - 1, tradesToday: 3 }, NOW)).toBe(0);
  });
});

describe("gate() SPEC §6.4 step 5: max per coin", () => {
  it("clips a BUY from cash to the cap", () => {
    const r = run(gateInput({ bot: { maxPerCoinBps: 2500 } }), buy("BTC", 80));
    expect(r.orders[0]!.bps).toBe(2500);
    expect(r.events).toEqual([
      { actionIndex: 0, asset: "BTC", action: "BUY", kind: "clip", reason: "coin_cap", fromBps: 8000, toBps: 2500, countsForF1: true },
    ]);
  });

  it("counts what is already held", () => {
    const input = gateInput({ portfolio: portfolio({ BTC: 20 }), bot: { maxPerCoinBps: 3000 } });
    // Room is 100 of the 800 cash.
    expect(run(input, buy("BTC", 50)).orders[0]!.bps).toBe(1250);
  });

  it("drops a BUY with no room left", () => {
    const input = gateInput({ portfolio: portfolio({ BTC: 40 }), bot: { maxPerCoinBps: 4000 } });
    expect(run(input, buy("BTC", 10)).events[0]).toMatchObject({ kind: "drop", reason: "coin_cap" });
  });

  it("counts earlier actions on the same asset", () => {
    const r = run(gateInput({ bot: { maxPerCoinBps: 3000 } }), buy("BTC", 20), buy("BTC", 20));
    // 200 bought, room left is 100 of the 800 cash.
    expect(r.orders.map((o) => o.bps)).toEqual([2000, 1250]);
  });

  it("leaves a BUY exactly at the cap alone", () => {
    expect(run(gateInput({ bot: { maxPerCoinBps: 2500 } }), buy("BTC", 25)).events).toEqual([]);
  });

  it("never caps a SELL", () => {
    const input = gateInput({ portfolio: portfolio({ BTC: 80 }), bot: { maxPerCoinBps: 1000 } });
    expect(run(input, sell("BTC", 10)).orders[0]!.bps).toBe(1000);
  });
});

describe("gate() SPEC §6.4 step 6: cash only, min order 1 %", () => {
  it("never spends more cash than there is", () => {
    const input = gateInput();
    const r = run(input, buy("BTC", 100), buy("ETH", 100), buy("SOL", 100));
    expect(r.orders.map((o) => o.bps)).toEqual([5000, 10000]);
    expect(executeBatch(input.bot, input.portfolio, input.prices, r.orders).portfolio.cashE8).toBe(0n);
    expect(r.events.at(-1)).toMatchObject({ actionIndex: 2, reason: "low_cash" });
  });

  it("cannot sell more than it holds (no shorting)", () => {
    const input = gateInput({ portfolio: portfolio({ BTC: 40 }) });
    const r = run(input, sell("BTC", 100), sell("BTC", 100));
    expect(r.orders).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ actionIndex: 1, reason: "no_holding" });
    expect(executeBatch(input.bot, input.portfolio, input.prices, r.orders).portfolio.unitsE18.BTC).toBe(0n);
  });

  it("lets a SELL fund a later BUY", () => {
    const r = run(gateInput({ portfolio: portfolio({ BTC: 100 }) }), sell("BTC", 30), buy("ETH", 100));
    expect(r.orders.map((o) => [o.buy, o.bps])).toEqual([[false, 3000], [true, 10000]]);
  });

  it("drops an order under 1 % of the portfolio", () => {
    expect(run(gateInput({ portfolio: portfolio({ BTC: 50 }) }), buy("ETH", 1)).events[0]).toMatchObject({ reason: "min_order" });
    expect(run(gateInput({ portfolio: portfolio({ BTC: 10 }) }), sell("BTC", 5)).events[0]).toMatchObject({ reason: "min_order" });
  });

  it("records both events when a clip lands under the minimum", () => {
    const base = portfolio({ BTC: 24 });
    const input = gateInput({ portfolio: base, bot: { maxPerCoinBps: 2450 } });
    const r = run(input, buy("BTC", 50));
    expect(r.orders).toEqual([]);
    expect(r.events.map((e) => [e.kind, e.reason])).toEqual([["clip", "coin_cap"], ["drop", "min_order"]]);
  });

  it("drops pct 0", () => {
    expect(run(gateInput(), buy("BTC", 0)).events[0]).toMatchObject({ reason: "zero" });
  });
});

describe("gate() SPEC §6.4 step 7: gate events", () => {
  it("records one event per clipped or dropped action and none for a clean one", () => {
    const r = run(gateInput({ bot: { maxPerCoinBps: 2000 } }), buy("BTC", 50), buy("ETH", 10), sell("SOL", 10));
    expect(r.events.map((e) => [e.actionIndex, e.kind, e.reason])).toEqual([[0, "clip", "coin_cap"], [2, "drop", "no_holding"]]);
    expect(r.proposedActions).toBe(3);
  });

  it("HOLD and empty actions are not proposals", () => {
    expect(run(gateInput(), hold("BTC"))).toMatchObject({ status: "held", proposedActions: 0, events: [] });
    expect(run(gateInput())).toMatchObject({ status: "held", proposedActions: 0, events: [] });
  });

  it("does not blame a paused bot", () => {
    expect(run(gateInput({ bot: { active: false } }), buy("BTC", 10)).events[0]).toMatchObject({ reason: "inactive", countsForF1: false });
  });
});

describe("gate() orders", () => {
  it("orderId = keccak256(abi.encode(decisionId, actionIndex)) with HOLDs counted in the index", () => {
    const r = run(gateInput(), hold("SOL"), buy("ETH", 10));
    expect(r.orders[0]).toEqual({
      botId: 7n,
      asset: 1,
      buy: true,
      bps: 1000,
      decisionId: DECISION_ID,
      actionIndex: 1,
      orderId: keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint8" }], [DECISION_ID, 1])),
    });
  });

  it("is pure: same input, same result, input untouched", () => {
    const input = gateInput({ portfolio: portfolio({ BTC: 20 }) });
    const before = structuredClone(input);
    expect(run(input, buy("ETH", 20))).toEqual(run(input, buy("ETH", 20)));
    expect(input).toEqual(before);
  });
});

describe("gate() against IPaperLedger semantics", () => {
  const sol = readFileSync(
    new URL("../../../packages/contracts/src/interfaces/IPaperLedger.sol", import.meta.url),
    "utf8",
  );

  it("SKIP_REASONS is the contract's SkipReason enum, in order", () => {
    const body = /enum SkipReason \{([^}]*)\}/.exec(sol)![1]!;
    expect(body.split(",").map((s) => s.trim())).toEqual([...SKIP_REASONS]);
  });

  it("Order has the contract's fields, in order", () => {
    const body = /struct Order \{([^}]*)\}/.exec(sol)![1]!;
    const fields = body.trim().split(";").filter(Boolean).map((s) => s.trim().split(" ")[1]);
    const { orderId: _, ...order } = run(gateInput(), buy("BTC", 10)).orders[0]!;
    expect(Object.keys(order satisfies LedgerOrder)).toEqual(fields);
  });

  const cases: [string, GateInput, ReturnType<typeof buy>][] = [
    ["inactive", gateInput({ bot: { active: false } }), buy("BTC", 10)],
    ["stale", gateInput({ prices: prices([]) }), buy("BTC", 10)],
    ["no_holding", gateInput(), sell("BTC", 10)],
    ["trade_limit", gateInput({ bot: { tradesToday: 8 } }), buy("BTC", 10)],
    ["coin_cap", gateInput({ portfolio: portfolio({ BTC: 50 }) }), buy("BTC", 10)],
    ["zero", gateInput(), buy("BTC", 0)],
    ["min_order", gateInput({ portfolio: portfolio({ BTC: 50 }) }), buy("ETH", 1)],
    ["low_cash", gateInput({ portfolio: { ...portfolio({ BTC: 99 }), cashE8: 9n * E8 } }), buy("ETH", 100)],
  ];

  it.each(cases)("drop %s means what the ledger would do with that order", (reason, input, action) => {
    expect(run(input, action).events.at(-1)).toMatchObject({ kind: "drop", reason });
    const raw: LedgerOrder = {
      botId: 7n,
      asset: action.asset === "BTC" ? 0 : 1,
      buy: action.action === "BUY",
      bps: action.pct * 100,
      decisionId: DECISION_ID,
      actionIndex: 0,
    };
    const expected = LEDGER_EQUIVALENT[reason as keyof typeof LEDGER_EQUIVALENT];
    const { skips } = executeBatch(input.bot, input.portfolio, input.prices, [raw]);
    expect(skips.map((s) => s.reason)).toEqual(expected ? [expected] : []);
  });

  it("no gated batch is ever skipped by the ledger at the same prices (5,000 random decisions)", () => {
    const rnd = seeded(43);
    const assets = ["BTC", "ETH", "SOL", "XRP", "GOLD"] as const;
    for (let i = 0; i < 5000; i++) {
      const p = { ...prices(), ...(rnd(4) === 0 ? liveStalePrices() : {}) };
      for (const a of assets) p[a] = { ...p[a], priceE8: p[a].priceE8 + BigInt(rnd(1_000_003)) };
      const input = gateInput({
        prices: p,
        portfolio: portfolio({ BTC: rnd(30), ETH: rnd(30), GOLD: rnd(30) }),
        bot: { maxPerCoinBps: 1000 + 500 * rnd(9), maxTradesPerDay: 1 + rnd(8) },
      });
      const actions = Array.from({ length: 1 + rnd(3) }, () =>
        (rnd(3) === 0 ? sell : buy)(assets[rnd(5)]!, rnd(101)),
      );
      const r = run(input, ...actions);
      const after = executeBatch(input.bot, input.portfolio, input.prices, r.orders);
      expect(after.skips).toEqual([]);
      for (const o of r.orders.filter((o) => o.buy)) {
        const asset = assets[o.asset]!;
        // Selling another asset later cannot push this one over the cap: the total value is unchanged.
        const position = positionValueE8(after.portfolio, p, asset);
        const cap = (portfolioValueE8(after.portfolio, p) * BigInt(input.bot.maxPerCoinBps)) / 10_000n;
        expect(position <= cap + 3n).toBe(true);
      }
    }
  });
});
