import { ASSET_IDS, type ApprovedOrder } from "../interfaces";
import { checkTrade } from "./check";
import { toOrder } from "./gate";
import { applyTrade, BPS, portfolioValueE8, positionValueE8 } from "./ledger-math";
import type { DropReason, GateInput, GateOrder, Portfolio } from "./types";

export interface ShrinkInput extends Pick<GateInput, "bot" | "portfolio" | "prices" | "nowSeconds" | "bigMove"> {
  /** A `big_moves` row that is still `pending`. */
  pending: ApprovedOrder;
  /** `usedOrder[orderId]` read from PaperLedger just before this call (SPEC §4.3). */
  orderUsed: boolean;
  /** `expired`: no answer by the deadline. `owner`: the owner tapped Shrink, so don't wait. */
  trigger: "expired" | "owner";
  /**
   * A SELL's units of the asset when the gate that made the big move started (#347), so the shrink keeps the
   * cumulative total under the threshold as isBigMove() judges it. Absent: judged on the holding now, as shrinks
   * logged before #347 were, so they replay unchanged.
   */
  startUnitsE18?: bigint;
}

export type ShrinkResult =
  /** The owner's approval already executed. Send nothing. */
  | { outcome: "already_executed" }
  /** The deadline hasn't passed; the owner can still approve. */
  | { outcome: "not_due" }
  /** Price too old. Retry at +5/+10/+15 min (SPEC §5 rule 4), then give up and hold. */
  | { outcome: "stale" }
  /** A limit says no. The big move expires without a trade. */
  | { outcome: "drop"; reason: DropReason }
  /**
   * Put `order` in the next batch; the row becomes `shrunk`. When a bot has several, feed `portfolioAfter`
   * and `tradesTodayAfter` into the next one, and into gate() for that batch's new decision.
   */
  | { outcome: "execute"; order: GateOrder; portfolioAfter: Portfolio; tradesTodayAfter: number };

/**
 * SPEC §6.4 step 10: shrink a big move to just under the threshold, re-check limits and freshness, and
 * keep decisionId + actionIndex so the orderId is the same and the contract blocks double execution.
 * Call it when the next batch is built, with that moment's portfolio and prices.
 *
 * "Just under": a BUY may spend at most `floor((threshold × V − 1) / 10000) − held`, the largest amount
 * for which `(held + spend) × 10000 < threshold × V`. A SELL becomes `threshold − 1` bps, and with
 * `startUnitsE18` it also sells at most `floor(start × (threshold − 1) / 10000) − (start − held)` units, so this
 * decision's SELLs of the asset stay under the threshold in total. Neither ever grows past what the bot asked for.
 */
export function shrinkBigMove(input: ShrinkInput): ShrinkResult {
  const { pending, bot, portfolio, prices, bigMove } = input;
  if (input.orderUsed) return { outcome: "already_executed" };
  // The contract accepts an approval while block.timestamp ≤ deadline.
  if (input.trigger === "expired" && BigInt(input.nowSeconds) <= pending.deadline) return { outcome: "not_due" };

  if (pending.botId !== bot.botId) throw new Error(`big move of bot ${pending.botId} shrunk with bot ${bot.botId}'s state`);
  const asset = ASSET_IDS[pending.asset];
  if (!asset) throw new Error(`unknown asset index ${pending.asset}`);

  let bps = pending.bps;
  if (pending.buy) {
    const value = portfolioValueE8(portfolio, prices);
    const most = (value * BigInt(bigMove.buyWeightBps) - 1n) / BPS - positionValueE8(portfolio, prices, asset);
    const mostBps = most > 0n && portfolio.cashE8 > 0n ? Number((most * BPS) / portfolio.cashE8) : 0;
    bps = Math.min(bps, mostBps);
  } else {
    bps = Math.min(bps, bigMove.sellBps - 1);
    const start = input.startUnitsE18;
    if (start !== undefined) {
      const held = portfolio.unitsE18[asset];
      const allowed = (start * BigInt(bigMove.sellBps - 1)) / BPS - (start - held);
      // bps ≤ 0 drops it as "zero" in checkTrade.
      bps = allowed > 0n && held > 0n ? Math.min(bps, Number((allowed * BPS) / held)) : 0;
    }
  }

  const result = checkTrade(input, portfolio, { asset, buy: pending.buy, bps }, bot.maxTradesPerDay - bot.tradesToday);
  if (!result.ok) return result.reason === "stale" ? { outcome: "stale" } : { outcome: "drop", reason: result.reason };

  return {
    outcome: "execute",
    order: toOrder({ bot, decisionId: pending.decisionId }, result.trade, pending.actionIndex),
    portfolioAfter: applyTrade(portfolio, prices, result.trade),
    tradesTodayAfter: bot.tradesToday + 1,
  };
}
