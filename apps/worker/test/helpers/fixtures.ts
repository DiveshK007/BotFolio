import type { AssetId } from "@botfolio/shared";
import { ASSETS } from "@botfolio/shared";
import type { GateBot, GateInput, Portfolio, Price } from "../../src/gate/types";
import type { DecisionAction, DecisionOutput } from "../../src/decision/schema";
import { classifyRound } from "../../src/oracle";

export const E8 = 100_000_000n;
export const DECISION_ID = `0x${"ab".repeat(32)}` as const;
/** 2026-11-22 13:13 IST, when the stale snapshot below was seen live. */
export const NOW = Date.parse("2026-11-22T13:13:00+05:30") / 1000;

export const PRICE_E8: Record<AssetId, bigint> = {
  BTC: 60_000n * E8,
  ETH: 1_700n * E8,
  SOL: 70n * E8,
  XRP: 93_000_000n,
  GOLD: 3_550n * E8,
};

const ALL: readonly AssetId[] = ["BTC", "ETH", "SOL", "XRP", "GOLD"];

export function prices(fresh: readonly AssetId[] = ALL): Record<AssetId, Price> {
  return Object.fromEntries(ALL.map((a) => [a, { priceE8: PRICE_E8[a], fresh: fresh.includes(a) }])) as Record<
    AssetId,
    Price
  >;
}

/**
 * Live feed ages on Nov 22 at 13:13 IST: SOL 71 min, XRP 143 min, Gold 774 min; BTC and ETH were fresh
 * (their ages here are illustrative). Freshness comes from the real §5 rule, not hard-coded booleans.
 */
export function liveStalePrices(): Record<AssetId, Price> {
  const ageMinutes: Record<AssetId, number> = { BTC: 5, ETH: 5, SOL: 71, XRP: 143, GOLD: 774 };
  return Object.fromEntries(
    ASSETS.map(({ id, maxAgeSeconds }) => {
      const round = {
        roundId: 1n,
        answer: PRICE_E8[id],
        updatedAt: BigInt(NOW - ageMinutes[id] * 60),
        answeredInRound: 1n,
      };
      return [id, { priceE8: PRICE_E8[id], fresh: classifyRound(round, NOW, maxAgeSeconds).fresh }];
    }),
  ) as Record<AssetId, Price>;
}

/** A portfolio worth 1000 play USDT, described by the % in each asset. The rest is cash. */
export function portfolio(weights: Partial<Record<AssetId, number>> = {}): Portfolio {
  let cashPct = 100;
  const unitsE18 = { BTC: 0n, ETH: 0n, SOL: 0n, XRP: 0n, GOLD: 0n };
  for (const [asset, pct] of Object.entries(weights) as [AssetId, number][]) {
    cashPct -= pct;
    const valueE8 = BigInt(pct * 10) * E8;
    // Round up so the position is worth exactly `valueE8` after the ledger rounds down.
    unitsE18[asset] = (valueE8 * 10n ** 18n + PRICE_E8[asset] - 1n) / PRICE_E8[asset];
  }
  return { cashE8: BigInt(cashPct * 10) * E8, unitsE18 };
}

export function gateInput(
  over: Omit<Partial<GateInput>, "bot"> & { bot?: Partial<GateBot> } = {},
): GateInput {
  return {
    decisionId: DECISION_ID,
    portfolio: portfolio(),
    prices: prices(),
    ...over,
    bot: { botId: 7n, active: true, maxPerCoinBps: 5000, maxTradesPerDay: 8, tradesToday: 0, ...over.bot },
  };
}

export const buy = (asset: AssetId, pct: number): DecisionAction => ({ asset, action: "BUY", pct });
export const sell = (asset: AssetId, pct: number): DecisionAction => ({ asset, action: "SELL", pct });
export const hold = (asset: AssetId): DecisionAction => ({ asset, action: "HOLD", pct: 0 });

export function decision(...actions: DecisionAction[]): DecisionOutput {
  return { actions, reason: "Rotating a little into what looks strong.", reason_tag: "rebalance", roast: "" };
}

/** Seeded PRNG, so property tests are the same on every run. */
export function seeded(seed: number): (n: number) => number {
  let s = seed;
  return (n) => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return Math.floor((s / 2 ** 32) * n);
  };
}
