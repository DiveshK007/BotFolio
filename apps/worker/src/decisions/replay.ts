import type { AssetId } from "@botfolio/shared";
import type { Hex } from "viem";
import type { GateInput } from "../gate/types";
import { ASSET_IDS } from "../interfaces";
import type { OracleReading } from "../oracle";

/** The exact integers the gate saw. §6.2's input JSON has rounded floats, so it can't replay a gate. */
export interface StoredGateInput {
  decisionId: Hex;
  nowSeconds: number;
  bot: Omit<GateInput["bot"], "botId"> & { botId: string };
  portfolio: { cashE8: string; unitsE18: Record<AssetId, string> };
  prices: Record<AssetId, { priceE8: string; fresh: boolean }>;
  bigMove: GateInput["bigMove"];
}

/** One asset's oracle round behind the decision, re-readable with `getRoundData(roundId)` (SPEC §6.5). */
export interface StoredRound {
  asset: AssetId;
  roundId: string;
  priceE8: string;
  updatedAt: number;
  fresh: boolean;
}

const perAsset = <T>(value: (asset: AssetId) => T) =>
  Object.fromEntries(ASSET_IDS.map((asset) => [asset, value(asset)])) as Record<AssetId, T>;

export function storeGateInput(input: GateInput): StoredGateInput {
  const { decisionId, nowSeconds, bot, portfolio, prices, bigMove } = input;
  return {
    decisionId,
    nowSeconds,
    bot: { ...bot, botId: bot.botId.toString() },
    portfolio: { cashE8: portfolio.cashE8.toString(), unitsE18: perAsset((a) => portfolio.unitsE18[a].toString()) },
    prices: perAsset((a) => ({ priceE8: prices[a].priceE8.toString(), fresh: prices[a].fresh })),
    bigMove: { ...bigMove },
  };
}

/** What a replay passes to `gate()`. */
export function readGateInput(stored: StoredGateInput): GateInput {
  const { decisionId, nowSeconds, bot, portfolio, prices, bigMove } = stored;
  return {
    decisionId,
    nowSeconds,
    bot: { ...bot, botId: BigInt(bot.botId) },
    portfolio: { cashE8: BigInt(portfolio.cashE8), unitsE18: perAsset((a) => BigInt(portfolio.unitsE18[a])) },
    prices: perAsset((a) => ({ priceE8: BigInt(prices[a].priceE8), fresh: prices[a].fresh })),
    bigMove,
  };
}

export function storeRounds(readings: readonly OracleReading[]): StoredRound[] {
  return readings.map(({ asset, roundId, priceE8, updatedAt, fresh }) => ({ asset, roundId, priceE8, updatedAt, fresh }));
}
