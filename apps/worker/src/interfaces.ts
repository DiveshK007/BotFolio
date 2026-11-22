import { ASSETS, type AssetId } from "@botfolio/shared";
import type { Hex } from "viem";

export { APPROVED_ORDER_TYPES, istDay, orderIdOf, paperLedgerDomain, type ApprovedOrder } from "@botfolio/shared";

/** `IPaperLedger.Order`, the struct `executeBatch` takes. Runner-only, so it isn't in relay.ts. */
export interface LedgerOrder {
  botId: bigint;
  /** 0 BTC, 1 ETH, 2 SOL, 3 XRP, 4 GOLD. */
  asset: number;
  buy: boolean;
  /** BUY: share of cash at execution. SELL: share of the holding at execution. */
  bps: number;
  decisionId: Hex;
  actionIndex: number;
}

/** `IPaperLedger.SkipReason`, in the contract's enum order. */
export const SKIP_REASONS = ["STALE", "LIMIT", "INACTIVE", "ZERO", "USED"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Index the contracts use for each asset. */
export const ASSET_INDEX = Object.fromEntries(ASSETS.map((a) => [a.id, a.index])) as Record<AssetId, number>;

export const ASSET_IDS: readonly AssetId[] = ASSETS.map((a) => a.id);
