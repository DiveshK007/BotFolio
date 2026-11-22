import { ASSET_INDEX, orderIdOf } from "../interfaces";
import { BPS, portfolioValueE8, positionValueE8, tradeAmounts, type Trade } from "./ledger-math";
import type { BigMove, GateInput, Portfolio } from "./types";

/**
 * SPEC §2.2 / §6.4 step 9, both thresholds inclusive:
 *   BUY  → post-trade weight ≥ 30 %: (held + spend) × 10000 ≥ threshold × V
 *   SELL → ≥ 50 % of the holding:    bps ≥ threshold
 * V is the same before and after a trade at the oracle price, and cross-multiplying avoids dividing.
 */
export function isBigMove(input: Pick<GateInput, "prices" | "bigMove">, portfolio: Portfolio, trade: Trade): boolean {
  if (!trade.buy) return trade.bps >= input.bigMove.sellBps;
  const after = positionValueE8(portfolio, input.prices, trade.asset) + tradeAmounts(portfolio, input.prices, trade).cashE8;
  return after * BPS >= portfolioValueE8(portfolio, input.prices) * BigInt(input.bigMove.buyWeightBps);
}

export function toBigMove(input: GateInput, portfolio: Portfolio, trade: Trade, actionIndex: number): BigMove {
  const { prices, decisionId, bot } = input;
  const moved = tradeAmounts(portfolio, prices, trade).cashE8;
  const held = positionValueE8(portfolio, prices, trade.asset);
  const after = trade.buy ? held + moved : held - moved;
  const value = portfolioValueE8(portfolio, prices);
  return {
    order: {
      botId: bot.botId,
      asset: ASSET_INDEX[trade.asset],
      buy: trade.buy,
      bps: trade.bps,
      decisionId,
      actionIndex,
      deadline: BigInt(input.nowSeconds + Math.floor(input.bigMove.ttlMs / 1000)),
    },
    orderId: orderIdOf(decisionId, actionIndex),
    postWeightBps: Number((after * BPS) / value),
  };
}
