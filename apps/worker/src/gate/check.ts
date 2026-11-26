import { applyTrade, BPS, portfolioValueE8, positionValueE8, priceOf, tradeAmounts, type Trade } from "./ledger-math";
import type { DropReason, GateInput, Portfolio } from "./types";

/** SPEC §6.4 step 6: min order = 1 % of portfolio. Step 3 uses the same 1 % for "BUY with cash < 1 %". */
const ONE_PERCENT = 100n;
/**
 * A BUY clipped to the per-coin cap aims this far below it (#219). Clipped exactly to the cap, a price tick before
 * the batch lands would make the contract's check fail and skip the order.
 */
export const CLIP_MARGIN_BPS = 10n;

export type CheckResult =
  | { ok: false; reason: DropReason; clippedTo?: number }
  | { ok: true; trade: Trade; clippedTo?: number };

/**
 * SPEC §6.4 steps 2–6 for one trade, against the portfolio as it stands at that point in the batch.
 *
 * Step 5 math: a BUY moves cash into the asset, so portfolio value V is unchanged and the post-trade
 * position is `held + cash`. The most we may spend is `room = floor(V × (cap − 10 bps margin) / 10000) − held`, and as a
 * share of cash that is `floor(room × 10000 / cash)` bps. Both round down, so the contract's check
 * passes at the same prices. That check is `position after × 10000 ≤ V before × cap` (PaperLedger uses
 * the pre-trade total), and we only clip when it would fail: rounding dust alone must not cost the bot
 * a gate event.
 */
export function checkTrade(
  ctx: Pick<GateInput, "bot" | "prices">,
  portfolio: Portfolio,
  trade: Trade,
  tradesLeft: number,
): CheckResult {
  const { bot, prices } = ctx;
  const { asset, buy } = trade;

  if (!bot.active) return { ok: false, reason: "inactive" };

  // Step 2. An unusable answer is STALE in the contract too.
  if (!prices[asset].fresh || priceOf(prices, asset) === 0n) return { ok: false, reason: "stale" };

  // Step 3.
  const value = portfolioValueE8(portfolio, prices);
  if (!buy && portfolio.unitsE18[asset] <= 0n) return { ok: false, reason: "no_holding" };
  if (buy && (portfolio.cashE8 <= 0n || portfolio.cashE8 * BPS < value * ONE_PERCENT)) {
    return { ok: false, reason: "low_cash" };
  }

  // Step 4.
  if (tradesLeft <= 0) return { ok: false, reason: "trade_limit" };
  if (trade.bps <= 0) return { ok: false, reason: "zero" };

  // Step 6, first half: never more than all the cash or all the holding, so no leverage and no shorting.
  let bps = Math.min(trade.bps, Number(BPS));
  let clippedTo: number | undefined;

  // Step 5, in the contract's order: ZERO before the cap, and the cap only bites if its own check fails.
  if (buy) {
    if (tradeAmounts(portfolio, prices, { asset, buy, bps }).unitsE18 <= 0n) return { ok: false, reason: "zero" };
    const cap = BigInt(bot.maxPerCoinBps);
    const after = applyTrade(portfolio, prices, { asset, buy, bps });
    if (positionValueE8(after, prices, asset) * BPS > value * cap) {
      const room = (value * (cap - CLIP_MARGIN_BPS)) / BPS - positionValueE8(portfolio, prices, asset);
      if (room <= 0n) return { ok: false, reason: "coin_cap" };
      bps = Number((room * BPS) / portfolio.cashE8);
      clippedTo = bps;
    }
  }

  // An amount that rounds to 0 is ZERO on-chain (units for a BUY, cash for a SELL), not just a small order.
  const amounts = tradeAmounts(portfolio, prices, { asset, buy, bps });
  if (amounts.unitsE18 <= 0n || amounts.cashE8 <= 0n) return { ok: false, reason: "zero", clippedTo };

  // Step 6, second half. A SELL of the whole holding is exempt, so a small position can still be closed (#219).
  const fullExit = !buy && bps >= Number(BPS);
  if (!fullExit && amounts.cashE8 * BPS < value * ONE_PERCENT) return { ok: false, reason: "min_order", clippedTo };

  return { ok: true, trade: { asset, buy, bps }, clippedTo };
}
