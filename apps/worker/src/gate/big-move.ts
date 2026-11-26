import { ASSET_INDEX, orderIdOf } from "../interfaces";
import { BPS, portfolioValueE8, positionValueE8, tradeAmounts, type Trade } from "./ledger-math";
import type { BigMove, GateInput, Portfolio } from "./types";

/**
 * SPEC §2.2 / §6.4 step 9, both thresholds inclusive, and cumulative per asset within one decision (#219):
 *   BUY  → post-trade weight ≥ 30 %: (held + spend) × 10000 ≥ threshold × V. `portfolio` already has this
 *          decision's earlier batch trades, so two BUYs of one asset count together.
 *   SELL → ≥ 50 % of the holding the decision started with, counting this decision's earlier SELLs of it:
 *          two SELLs of 40 % are 64 % and need approval.
 * V is the same before and after a trade at the oracle price, and cross-multiplying avoids dividing.
 */
export function isBigMove(input: Pick<GateInput, "prices" | "bigMove" | "portfolio">, portfolio: Portfolio, trade: Trade): boolean {
  if (!trade.buy) {
    if (trade.bps >= input.bigMove.sellBps) return true;
    const start = input.portfolio.unitsE18[trade.asset];
    const left = portfolio.unitsE18[trade.asset] - tradeAmounts(portfolio, input.prices, trade).unitsE18;
    return (start - left) * BPS >= start * BigInt(input.bigMove.sellBps);
  }
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
