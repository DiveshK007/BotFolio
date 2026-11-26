import type { AssetId } from "@botfolio/shared";
import type { ReasonTag } from "../decision/schema";
import { applyTrade, BPS, portfolioValueE8, positionValueE8, priceOf, tradeAmounts, type Trade } from "../gate/ledger-math";
import type { Portfolio, Price } from "../gate/types";
import { ASSET_IDS } from "../interfaces";
import { isNineAmSlot } from "../ist";
import type { HouseAction, HouseOutput } from "./schema";

/*
 * The three house bots of SPEC §8. Deterministic, no LLM. Their output goes through gate() like any
 * decision (per-coin cap, trades/day, stale prices), except that they never produce big moves.
 */

export type HouseStrategy = "steady_sam" | "gold_granny" | "momentum_max";

/** For the `decisions` row: `model` and `prompt_version`. Bump the version when a rule changes. */
export const HOUSE_MODEL = "house-rules";
export const HOUSE_RULES_VERSION = "house-rules-v1";

const STEADY_SAM_WEIGHT_BPS = 2000; // 20 % in each of the 5
const GOLD_GRANNY_WEIGHT_BPS = 5000; // 50 % Gold, 50 % cash: createHouseBot caps a coin at 50 % (#219 item 9)
const MOMENTUM_WEIGHT_BPS = 2500; // up to 25 % each
const MOMENTUM_THRESHOLD_PCT = 2; // strictly more than +2 %, strictly less than −2 %
const MIN_ORDER_BPS = 100n; // the gate's 1 %: don't propose what it would drop

const UNIVERSE: Readonly<Record<HouseStrategy, readonly AssetId[]>> = {
  steady_sam: ASSET_IDS,
  gold_granny: ["GOLD"],
  momentum_max: ASSET_IDS,
};

export interface HouseContext {
  strategy: HouseStrategy;
  /** The slot's scheduled time, also on a stale retry. */
  slot: { kind: "scheduled" | "debut"; time: Date };
  /** `seasons.starts_at` of the season the slot is in; null outside a season. */
  seasonStart: Date | null;
  portfolio: Portfolio;
  prices: Readonly<Record<AssetId, Price>>;
  // TODO(#49): compute from stored oracle rounds (SPEC §6.2: no external price API).
  chg24hPct: Partial<Record<AssetId, number | null>>;
  /**
   * On a stale retry: assets this decision already traded. Their orderId is used, so ordering them
   * again would be skipped on-chain and throw off the sizes of the buys after them.
   */
  alreadyTraded?: readonly AssetId[];
}

/** SPEC §8: "rebalanced at the first 09:00 slot of each season". */
export function isRebalanceSlot(slot: HouseContext["slot"], seasonStart: Date | null): boolean {
  if (!seasonStart || slot.kind !== "scheduled" || !isNineAmSlot(slot.time)) return false;
  const sinceOpen = slot.time.getTime() - seasonStart.getTime();
  return sinceOpen >= 0 && sinceOpen < 86_400_000;
}

/** Where a strategy wants one asset. `buyOnly` tops up without trimming a winner. */
interface Target {
  weightBps: number;
  buyOnly?: boolean;
}

function targetFor(ctx: HouseContext, asset: AssetId): Target | null {
  if (ctx.alreadyTraded?.includes(asset)) return null;
  switch (ctx.strategy) {
    case "steady_sam":
      return isRebalanceSlot(ctx.slot, ctx.seasonStart) ? { weightBps: STEADY_SAM_WEIGHT_BPS } : null;
    case "gold_granny":
      return isRebalanceSlot(ctx.slot, ctx.seasonStart) ? { weightBps: GOLD_GRANNY_WEIGHT_BPS } : null;
    case "momentum_max": {
      const change = ctx.chg24hPct[asset];
      if (change === null || change === undefined) return null;
      if (change > MOMENTUM_THRESHOLD_PCT) return { weightBps: MOMENTUM_WEIGHT_BPS, buyOnly: true };
      if (change < -MOMENTUM_THRESHOLD_PCT) return { weightBps: 0 };
      return null; // between the two, or an unknown change: leave it
    }
  }
}

/**
 * Sells first, to free the cash, then buys in asset order. Each trade is sized against the portfolio
 * the previous ones leave, the same way gate() and the ledger run them.
 *
 * A stale asset still gets its action, so the gate records `stale` and the runner knows to retry it,
 * but it is not simulated: the fresh buys must not count on cash from a sale that can't happen, or
 * shrink to leave room for a buy that can't.
 */
function plan(ctx: HouseContext): HouseAction[] {
  const { prices } = ctx;
  const actions: HouseAction[] = UNIVERSE[ctx.strategy].map((asset) => ({ asset, action: "HOLD", bps: 0 }));
  let portfolio = ctx.portfolio;

  for (const buy of [false, true]) {
    for (const action of actions) {
      if (action.action !== "HOLD") continue;
      const target = targetFor(ctx, action.asset);
      if (!target || (!buy && target.buyOnly)) continue;

      const trade = sizeTrade(portfolio, prices, action.asset, buy, target.weightBps);
      if (!trade) continue;

      action.action = buy ? "BUY" : "SELL";
      action.bps = trade.bps;
      if (isTradable(prices, action.asset)) portfolio = applyTrade(portfolio, prices, trade);
    }
  }
  return actions;
}

/** The trade that moves `asset` toward its weight, or null if none of at least 1 % is possible. */
function sizeTrade(
  portfolio: Portfolio,
  prices: HouseContext["prices"],
  asset: AssetId,
  buy: boolean,
  weightBps: number,
): Trade | null {
  const value = portfolioValueE8(portfolio, prices);
  const held = positionValueE8(portfolio, prices, asset);
  const target = (value * BigInt(weightBps)) / BPS;

  const gap = buy ? target - held : held - target;
  const base = buy ? portfolio.cashE8 : held;
  if (gap <= 0n || base <= 0n) return null;

  const share = (gap * BPS) / base; // rounds down, so a buy never passes its target
  const trade = { asset, buy, bps: Number(share < BPS ? share : BPS) };
  return tradeAmounts(portfolio, prices, trade).cashE8 * BPS < value * MIN_ORDER_BPS ? null : trade;
}

function isTradable(prices: HouseContext["prices"], asset: AssetId): boolean {
  return prices[asset].fresh && priceOf(prices, asset) > 0n;
}

export function houseDecision(ctx: HouseContext): HouseOutput {
  const actions = plan(ctx);
  const wanted = actions.filter((a) => a.action !== "HOLD");
  const trading = wanted.filter((a) => isTradable(ctx.prices, a.asset));
  const bought = trading.filter((a) => a.action === "BUY");
  const sold = trading.filter((a) => a.action === "SELL");
  const stale = wanted.filter((a) => !isTradable(ctx.prices, a.asset));

  const lines: string[] = [];
  if (trading.length > 0) {
    if (ctx.strategy === "steady_sam") lines.push(`Steady Sam moved ${names(trading)} toward 20% each.`);
    if (ctx.strategy === "gold_granny") lines.push("Gold Granny moved Gold toward 50%, the rest in cash.");
    if (ctx.strategy === "momentum_max") {
      const did = [bought.length ? `bought ${names(bought)}` : "", sold.length ? `sold ${names(sold)}` : ""];
      lines.push(`Momentum Max ${did.filter(Boolean).join(", ")} on the 24h move.`);
    }
  }
  if (stale.length > 0) lines.push(`${names(stale)} price too old, holding.`);
  if (lines.length === 0) lines.push(holdLine(ctx));

  return { actions, reason: lines.join(" "), reason_tag: tagFor(ctx, bought.length, sold.length), roast: "" };
}

function names(actions: readonly HouseAction[]): string {
  return actions.map((a) => (a.asset === "GOLD" ? "Gold" : a.asset)).join(", ");
}

function holdLine({ strategy, slot, seasonStart }: HouseContext): string {
  if (strategy === "momentum_max") return "Momentum Max has nothing new to chase. Holding.";
  const rebalancing = isRebalanceSlot(slot, seasonStart);
  if (strategy === "steady_sam") {
    return rebalancing
      ? "Steady Sam is already balanced. Holding."
      : "Steady Sam doesn't fidget. Holding until the next season's rebalance.";
  }
  return rebalancing
    ? "Gold Granny has her Gold just right. Holding."
    : "Gold Granny is knitting. Holding until the next season's rebalance.";
}

/** Tags that agree with the actions, as trust factor F4 checks (SPEC §7). */
function tagFor(ctx: HouseContext, buys: number, sells: number): ReasonTag {
  if (buys + sells === 0) {
    return ASSET_IDS.some((a) => ctx.portfolio.unitsE18[a] > 0n) ? "persona_preference" : "stay_cash";
  }
  if (ctx.strategy !== "momentum_max" || (buys > 0 && sells > 0)) return "rebalance";
  return buys > 0 ? "trend_up" : "trend_down";
}
