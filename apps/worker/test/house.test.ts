import { validateJson } from "@botfolio/llm";
import type { AssetId } from "@botfolio/shared";
import { describe, expect, it } from "vitest";
import { loadBigMoveConfig } from "../src/config";
import { gate } from "../src/gate/gate";
import { portfolioValueE8, positionValueE8 } from "../src/gate/ledger-math";
import type { GateBot, Portfolio, Price } from "../src/gate/types";
import { HOUSE_OUTPUT_SCHEMA } from "../src/house/schema";
import { houseDecision, isRebalanceSlot, type HouseContext, type HouseStrategy } from "../src/house/strategies";
import { ASSET_IDS, orderIdOf } from "../src/interfaces";
import { bannedRules } from "../src/text/content-filter";
import { DECISION_ID, decision, gateInput, liveStalePrices, portfolio, prices, seeded } from "./helpers/fixtures";
import { executeBatch } from "./helpers/reference-ledger";

const ist = (time: string) => new Date(`${time}:00+05:30`);
const S0_OPEN = ist("2026-11-24T00:00");
const FIRST_NINE = { kind: "scheduled" as const, time: ist("2026-11-24T09:00") };
const ONE_PM = { kind: "scheduled" as const, time: ist("2026-11-24T13:00") };

const LIMITS: Record<HouseStrategy, Partial<GateBot>> = {
  steady_sam: { maxPerCoinBps: 2500, maxTradesPerDay: 8 },
  gold_granny: { maxPerCoinBps: 5000, maxTradesPerDay: 8 },
  momentum_max: { maxPerCoinBps: 2500, maxTradesPerDay: 8 },
};

/** Strategy → gate → reference ledger. The batch must land without a skip. */
function play(strategy: HouseStrategy, over: Partial<HouseContext> = {}, bot: Partial<GateBot> = {}) {
  const ctx: HouseContext = {
    strategy,
    slot: FIRST_NINE,
    seasonStart: S0_OPEN,
    portfolio: portfolio(),
    prices: prices(),
    chg24hPct: {},
    ...over,
  };
  const output = houseDecision(ctx);
  expect(validateJson(HOUSE_OUTPUT_SCHEMA, output)).toEqual([]);

  const input = gateInput({
    bot: { isHouse: true, ...LIMITS[strategy], ...bot },
    portfolio: ctx.portfolio,
    prices: ctx.prices,
    bigMove: loadBigMoveConfig({}), // the real thresholds, to show house bots ignore them
  });
  const result = gate(input, output, "gate-test");
  expect(result.status).not.toBe("invalid");
  expect(result.bigMoves).toEqual([]);
  expect(result.textFlags).toEqual([]);

  const ledger = executeBatch(input.bot, input.portfolio, input.prices, result.orders);
  expect(ledger.skips).toEqual([]);

  const weight = (asset: AssetId) =>
    Number((positionValueE8(ledger.portfolio, ctx.prices, asset) * 10_000n) / portfolioValueE8(ledger.portfolio, ctx.prices)) / 100;
  const traded = result.orders.map((o) => ASSET_IDS[o.asset]);
  const staleDrops = result.events.filter((e) => e.kind === "drop" && e.reason === "stale").map((e) => e.asset);
  return { output, result, after: ledger.portfolio, weight, traded, staleDrops };
}

describe("isRebalanceSlot(): first 09:00 slot of each season", () => {
  it.each([
    ["S0", "2026-11-24"],
    ["S1", "2026-11-26"],
    ["S2", "2026-11-28"],
    ["S3", "2026-11-30"],
    ["S4", "2026-12-02"],
    ["S5", "2026-12-04"],
    ["S6", "2026-12-07"],
  ])("%s rebalances on %s at 09:00 and only then", (_season, day) => {
    const start = ist(`${day}T00:00`);
    const slots: Date[] = [];
    for (let h = 0; h < 72; h += 24) {
      for (const hour of [9, 13, 17, 21]) slots.push(new Date(start.getTime() + (h + hour) * 3_600_000));
    }
    const hits = slots.filter((time) => isRebalanceSlot({ kind: "scheduled", time }, start));
    expect(hits).toEqual([ist(`${day}T09:00`)]);
  });

  it("not before the season, outside a season, or on a debut", () => {
    expect(isRebalanceSlot({ kind: "scheduled", time: ist("2026-11-23T09:00") }, S0_OPEN)).toBe(false);
    expect(isRebalanceSlot(FIRST_NINE, null)).toBe(false);
    expect(isRebalanceSlot({ kind: "debut", time: FIRST_NINE.time }, S0_OPEN)).toBe(false);
  });
});

describe("Steady Sam", () => {
  it("puts 20 % in each of the 5 assets from cash", () => {
    const r = play("steady_sam");
    expect(r.traded).toEqual(["BTC", "ETH", "SOL", "XRP", "GOLD"]);
    for (const asset of ASSET_IDS) expect(r.weight(asset)).toBeCloseTo(20, 0);
    expect(r.result.events).toEqual([]);
    expect(r.output.reason_tag).toBe("rebalance");
  });

  it("sells before it buys, keeping each asset's actionIndex", () => {
    const r = play("steady_sam", { portfolio: portfolio({ GOLD: 100 }) }, { maxPerCoinBps: 5000 });
    expect(r.result.orders.map((o) => [o.buy, o.actionIndex])).toEqual([
      [false, 4],
      [true, 0],
      [true, 1],
      [true, 2],
      [true, 3],
    ]);
    expect(r.result.orders[0]!.orderId).toBe(orderIdOf(DECISION_ID, 4));
    for (const asset of ASSET_IDS) expect(r.weight(asset)).toBeCloseTo(20, 0);
  });

  it("holds in every other slot", () => {
    const r = play("steady_sam", { slot: ONE_PM });
    expect(r.result).toMatchObject({ status: "held", proposedActions: 0 });
    expect(r.output.reason).toMatch(/Steady Sam/);
  });

  it("leaves a balanced portfolio alone", () => {
    const balanced = portfolio({ BTC: 20, ETH: 20, SOL: 20, XRP: 20, GOLD: 20 });
    expect(play("steady_sam", { portfolio: balanced }).result).toMatchObject({ status: "held", events: [] });
  });

  it("is clipped by trades per day like any bot", () => {
    const r = play("steady_sam", {}, { maxTradesPerDay: 3 });
    expect(r.traded).toEqual(["BTC", "ETH", "SOL"]);
    expect(r.result.events.map((e) => e.reason)).toEqual(["trade_limit", "trade_limit"]);
  });

  describe("only BTC and ETH fresh", () => {
    const stale = liveStalePrices();

    it("buys BTC and ETH at 20 % each and holds the rest, without spending their share", () => {
      const r = play("steady_sam", { prices: stale }, { maxPerCoinBps: 5000 });
      expect(r.traded).toEqual(["BTC", "ETH"]);
      expect(r.weight("BTC")).toBeCloseTo(20, 0);
      expect(r.weight("ETH")).toBeCloseTo(20, 0);
      expect(r.staleDrops).toEqual(["SOL", "XRP", "GOLD"]);
      expect(r.result.events.every((e) => !e.countsForF1)).toBe(true);
      expect(r.output.reason).toContain("SOL, XRP, Gold price too old");
    });

    it("doesn't buy with cash from a sale that can't happen", () => {
      const r = play("steady_sam", { prices: stale, portfolio: portfolio({ GOLD: 100 }) });
      expect(r.result.status).toBe("skipped_stale");
      expect(r.staleDrops).toEqual(["GOLD"]);
    });

    it("a later slot of the season buys only what the 09:00 rebalance couldn't (#219 item 19)", () => {
      const first = play("steady_sam", { prices: stale }, { maxPerCoinBps: 5000 });
      const later = play("steady_sam", { slot: ONE_PM, portfolio: first.after, pendingRebalance: first.staleDrops });
      expect(later.traded).toEqual(["SOL", "XRP", "GOLD"]);
      for (const asset of ASSET_IDS) expect(later.weight(asset)).toBeCloseTo(20, 0);
      expect(later.output.reason_tag).toBe("rebalance");
      // Not on a debut, and not outside a season.
      expect(play("steady_sam", { slot: { kind: "debut", time: ONE_PM.time }, pendingRebalance: ["SOL"] }).traded).toEqual([]);
      expect(play("steady_sam", { slot: ONE_PM, seasonStart: null, pendingRebalance: ["SOL"] }).traded).toEqual([]);
    });

    it("the retry finishes the rebalance with stable indexes", () => {
      const first = play("steady_sam", { prices: stale });
      const retry = play(
        "steady_sam",
        { portfolio: first.after, alreadyTraded: ["BTC", "ETH"] },
        { tradesToday: 2 },
      );
      expect(retry.result.orders.map((o) => o.actionIndex)).toEqual([2, 3, 4]);
      for (const asset of ASSET_IDS) expect(retry.weight(asset)).toBeCloseTo(20, 0);

      const ids = [...first.result.orders, ...retry.result.orders].map((o) => o.orderId);
      expect(new Set(ids).size).toBe(5);
    });
  });
});

describe("Gold Granny", () => {
  it("goes 50 / 50, inside the 50 % per-coin maximum, so the gate never clips her (#219 item 9)", () => {
    const r = play("gold_granny");
    expect(r.output.actions).toEqual([{ asset: "GOLD", action: "BUY", bps: 5000 }]);
    expect(r.weight("GOLD")).toBeCloseTo(50, 0);
    expect(r.result.events).toEqual([]);
    expect(r.output.reason).toBe("Gold Granny moved Gold toward 50%, the rest in cash.");
  });

  it("trims Gold above 50 %", () => {
    const r = play("gold_granny", { portfolio: portfolio({ GOLD: 80 }) });
    expect(r.weight("GOLD")).toBeCloseTo(50, 0);
  });

  it("holds in every other slot", () => {
    expect(play("gold_granny", { slot: ONE_PM }).result.status).toBe("held");
  });

  describe("only BTC and ETH fresh", () => {
    it("holds: Gold is all she trades", () => {
      const r = play("gold_granny", { prices: liveStalePrices() });
      expect(r.result).toMatchObject({ status: "skipped_stale", orders: [] });
      expect(r.staleDrops).toEqual(["GOLD"]);
      expect(r.output.reason).toBe("Gold price too old, holding.");
      expect(r.output.reason_tag).toBe("stay_cash");
    });

    it("the retry buys with the same orderId", () => {
      const stale = play("gold_granny", { prices: liveStalePrices() });
      const retry = play("gold_granny", { portfolio: stale.after });
      expect(retry.result.orders[0]!.orderId).toBe(orderIdOf(DECISION_ID, 0));
    });
  });
});

describe("Momentum Max", () => {
  const UP = { BTC: 3, ETH: 3, SOL: 3, XRP: 3, GOLD: 3 };

  it("buys up to 25 % of what is up more than 2 %", () => {
    const r = play("momentum_max", { slot: ONE_PM, chg24hPct: { BTC: 2.5, ETH: 1 } });
    expect(r.traded).toEqual(["BTC"]);
    expect(r.weight("BTC")).toBeCloseTo(25, 0);
    expect(r.output.reason_tag).toBe("trend_up");
  });

  it("sells all of what is down more than 2 %", () => {
    const r = play("momentum_max", { portfolio: portfolio({ ETH: 20 }), chg24hPct: { ETH: -2.1 } });
    expect(r.after.unitsE18.ETH).toBe(0n);
    expect(r.output.reason_tag).toBe("trend_down");
  });

  it("±2 % exactly, unknown and flat all mean leave it", () => {
    const r = play("momentum_max", {
      portfolio: portfolio({ ETH: 20 }),
      chg24hPct: { BTC: 2, ETH: -2, SOL: null, GOLD: 0 },
    });
    expect(r.result).toMatchObject({ status: "held", proposedActions: 0 });
  });

  it("funds buys with the sells of the same slot", () => {
    const r = play("momentum_max", {
      portfolio: portfolio({ ETH: 25, SOL: 25, XRP: 25, GOLD: 25 }),
      chg24hPct: { BTC: 4, ETH: -4 },
    });
    expect(r.traded).toEqual(["ETH", "BTC"]);
    expect(r.weight("BTC")).toBeCloseTo(25, 0);
    expect(r.output.reason_tag).toBe("rebalance");
  });

  it("doesn't trim a winner above 25 %", () => {
    const r = play("momentum_max", { portfolio: portfolio({ BTC: 35 }), chg24hPct: { BTC: 5 } });
    expect(r.result.proposedActions).toBe(0);
  });

  it("with five risers, cash runs out in asset order and nothing is recorded as a clip", () => {
    const r = play("momentum_max", { chg24hPct: UP });
    expect(r.traded).toEqual(["BTC", "ETH", "SOL", "XRP"]);
    expect(r.result.events).toEqual([]);
  });

  it("acts in every slot, not just 09:00", () => {
    for (const hour of ["09", "13", "17", "21"]) {
      const slot = { kind: "scheduled" as const, time: ist(`2026-11-25T${hour}:00`) };
      expect(play("momentum_max", { slot, chg24hPct: { SOL: 3 } }).traded).toEqual(["SOL"]);
    }
  });

  describe("only BTC and ETH fresh", () => {
    const stale = liveStalePrices();

    it("buys the fresh risers and holds the stale ones", () => {
      const r = play("momentum_max", { prices: stale, chg24hPct: UP });
      expect(r.traded).toEqual(["BTC", "ETH"]);
      expect(r.weight("BTC")).toBeCloseTo(25, 0);
      expect(r.weight("ETH")).toBeCloseTo(25, 0);
      expect(r.staleDrops).toEqual(["SOL", "XRP", "GOLD"]);
    });

    it("can't sell a stale faller or spend its cash", () => {
      const r = play("momentum_max", {
        prices: stale,
        portfolio: portfolio({ ETH: 25, SOL: 25, XRP: 25, GOLD: 25 }),
        chg24hPct: { BTC: 4, GOLD: -4 },
      });
      expect(r.result.status).toBe("skipped_stale");
      expect(r.staleDrops).toEqual(["GOLD"]);
    });

    it("the retry keeps the same indexes", () => {
      const first = play("momentum_max", { prices: stale, chg24hPct: UP });
      const retry = play(
        "momentum_max",
        { portfolio: first.after, chg24hPct: UP, alreadyTraded: ["BTC", "ETH"] },
        { tradesToday: 2 },
      );
      expect(retry.result.orders.map((o) => o.actionIndex)).toEqual([2, 3]);
    });
  });
});

describe("house output through gate()", () => {
  it("the two schemas don't mix", () => {
    const house = houseDecision({
      strategy: "gold_granny",
      slot: FIRST_NINE,
      seasonStart: S0_OPEN,
      portfolio: portfolio(),
      prices: prices(),
      chg24hPct: {},
    });
    expect(gate(gateInput(), house, "gate-test").status).toBe("invalid");
    const llm = decision({ asset: "BTC", action: "BUY", pct: 10 });
    expect(gate(gateInput({ bot: { isHouse: true } }), llm, "gate-test").status).toBe("invalid");
  });

  it("3,000 random slots: no skip, no big move, no clean-text flag, reasons in bounds", () => {
    const rnd = seeded(63);
    const strategies = ["steady_sam", "gold_granny", "momentum_max"] as const;
    for (let i = 0; i < 3000; i++) {
      const start: Portfolio = portfolio({ BTC: rnd(26), ETH: rnd(26), SOL: rnd(26), GOLD: rnd(23) });
      const p: Record<AssetId, Price> = rnd(3) === 0 ? liveStalePrices() : prices();
      const chg24hPct = Object.fromEntries(ASSET_IDS.map((a) => [a, rnd(101) / 10 - 5]));
      const r = play(strategies[rnd(3)]!, {
        slot: rnd(4) === 0 ? ONE_PM : FIRST_NINE,
        portfolio: start,
        prices: p,
        chg24hPct,
      });
      expect(r.output.reason.length).toBeGreaterThanOrEqual(10);
      expect(r.output.reason.length).toBeLessThanOrEqual(140);
      expect(bannedRules(r.output.reason)).toEqual([]);
    }
  });
});
