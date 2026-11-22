import type { AssetId } from "@botfolio/shared";
import { portfolioValueE8, positionValueE8, priceOf } from "../gate/ledger-math";
import type { Portfolio, Price } from "../gate/types";
import { ASSET_IDS } from "../interfaces";
import { istIso } from "../ist";

/** The SPEC §6.2 input JSON, key for key. This is what gets hashed, logged and sent to the model. */
export interface DecisionInput {
  slot: string;
  bot: {
    name: string;
    persona: string;
    rules: string;
    max_per_coin_pct: number;
    max_trades_per_day: number;
    trades_today: number;
    version: number;
  };
  portfolio: {
    cash_pct: number;
    holdings: { asset: AssetId; pct: number; avg_entry: number | null }[];
    value_inr_play: number;
  };
  market: { asset: AssetId; price: number; chg_24h_pct: number | null; chg_7d_pct: number | null; fresh: boolean }[];
  recent_corrections: { chip: string; note: string }[];
}

export interface PriceChange {
  /** null until there are stored oracle rounds that far back. */
  chg24hPct: number | null;
  chg7dPct: number | null;
}

export interface DecisionContext {
  slotTime: Date;
  bot: {
    name: string;
    persona: string;
    rules: string;
    maxPerCoinBps: number;
    maxTradesPerDay: number;
    tradesToday: number;
    version: number;
  };
  portfolio: Portfolio;
  /** PaperLedger's START_CASH_E8, for the ₹ display rule (SPEC §3). */
  startValueE8: bigint;
  avgEntryE8: Partial<Record<AssetId, bigint>>;
  prices: Readonly<Record<AssetId, Price>>;
  // TODO(#49): compute these from stored oracle rounds (SPEC §6.2: no external price API).
  changes: Partial<Record<AssetId, PriceChange>>;
  recentCorrections: readonly { chip: string; note: string | null }[];
}

export function buildDecisionInput(ctx: DecisionContext): DecisionInput {
  const { bot, portfolio, prices } = ctx;
  const value = portfolioValueE8(portfolio, prices);
  const pct = (part: bigint) => (value > 0n ? Number((part * 100n + value / 2n) / value) : 0);

  return {
    slot: istIso(ctx.slotTime),
    bot: {
      name: bot.name,
      persona: bot.persona,
      rules: bot.rules,
      max_per_coin_pct: bot.maxPerCoinBps / 100,
      max_trades_per_day: bot.maxTradesPerDay,
      trades_today: bot.tradesToday,
      version: bot.version,
    },
    portfolio: {
      cash_pct: pct(portfolio.cashE8),
      holdings: ASSET_IDS.filter((a) => portfolio.unitsE18[a] > 0n).map((asset) => {
        const entry = ctx.avgEntryE8[asset];
        return {
          asset,
          pct: pct(positionValueE8(portfolio, prices, asset)),
          avg_entry: entry === undefined ? null : Number(entry) / 1e8,
        };
      }),
      // displayINR = 100000 × value / startValue (SPEC §3).
      value_inr_play: ctx.startValueE8 > 0n ? Number((100_000n * value) / ctx.startValueE8) : 0,
    },
    market: ASSET_IDS.map((asset) => ({
      asset,
      price: Number(priceOf(prices, asset)) / 1e8,
      chg_24h_pct: oneDecimal(ctx.changes[asset]?.chg24hPct),
      chg_7d_pct: oneDecimal(ctx.changes[asset]?.chg7dPct),
      fresh: prices[asset].fresh,
    })),
    recent_corrections: ctx.recentCorrections.map(({ chip, note }) => ({ chip, note: note ?? "" })),
  };
}

function oneDecimal(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : Math.round(value * 10) / 10;
}
