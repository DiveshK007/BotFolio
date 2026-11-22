import type { AssetId } from "@botfolio/shared";
import { ASSET_IDS, istDay } from "../interfaces";
import type { Portfolio, Price } from "./types";

/*
 * The PaperLedger arithmetic (SPEC §4.3 step 4), with the same integer rounding:
 *   BUY:  cash  = cashE8 * bps / 10000,  units = cash * 1e18 / answer
 *   SELL: units = held   * bps / 10000,  cash  = units * answer / 1e18
 * Everything rounds down. The gate simulates a batch with these, so at unchanged prices
 * the contract computes exactly the same numbers.
 */

export const BPS = 10_000n;
export const E18 = 10n ** 18n;

type Prices = Readonly<Record<AssetId, Price>>;

/** A missing or non-positive answer counts as 0, like `portfolioValueE8`. */
export function priceOf(prices: Prices, asset: AssetId): bigint {
  const p = prices[asset].priceE8;
  return p > 0n ? p : 0n;
}

export function positionValueE8(portfolio: Portfolio, prices: Prices, asset: AssetId): bigint {
  return (portfolio.unitsE18[asset] * priceOf(prices, asset)) / E18;
}

/** Cash plus every holding at its latest answer. Stale answers still count, as in `portfolioValueE8`. */
export function portfolioValueE8(portfolio: Portfolio, prices: Prices): bigint {
  return ASSET_IDS.reduce((sum, a) => sum + positionValueE8(portfolio, prices, a), portfolio.cashE8);
}

export interface Trade {
  asset: AssetId;
  buy: boolean;
  bps: number;
}

export function tradeAmounts(portfolio: Portfolio, prices: Prices, trade: Trade): { cashE8: bigint; unitsE18: bigint } {
  const price = priceOf(prices, trade.asset);
  if (trade.buy) {
    const cashE8 = (portfolio.cashE8 * BigInt(trade.bps)) / BPS;
    return { cashE8, unitsE18: price > 0n ? (cashE8 * E18) / price : 0n };
  }
  const unitsE18 = (portfolio.unitsE18[trade.asset] * BigInt(trade.bps)) / BPS;
  return { cashE8: (unitsE18 * price) / E18, unitsE18 };
}

export function applyTrade(portfolio: Portfolio, prices: Prices, trade: Trade): Portfolio {
  const { cashE8, unitsE18 } = tradeAmounts(portfolio, prices, trade);
  const sign = trade.buy ? 1n : -1n;
  return {
    cashE8: portfolio.cashE8 - sign * cashE8,
    unitsE18: { ...portfolio.unitsE18, [trade.asset]: portfolio.unitsE18[trade.asset] + sign * unitsE18 },
  };
}

/** `portfolios(botId).tradesToday` only counts while `lastDay` is the current IST day. */
export function tradesTodayFrom(onChain: { lastDay: number; tradesToday: number }, nowSeconds: number): number {
  return onChain.lastDay === istDay(nowSeconds) ? onChain.tradesToday : 0;
}
