// TODO(#33): delete this file and import the same names from @botfolio/shared once relay.ts is on main.
import { ASSETS, type AssetId } from "@botfolio/shared";
import { encodeAbiParameters, keccak256, type Hex } from "viem";

/** `IPaperLedger.Order`, the struct `executeBatch` takes. */
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

/** Per-order replay key (SPEC §3): keccak256(abi.encode(decisionId, actionIndex)). Same as `IPaperLedger.orderIdOf`. */
export function orderIdOf(decisionId: Hex, actionIndex: number): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint8" }], [decisionId, actionIndex]));
}

/** IST day number, the formula the contracts use: (timestamp + 19800) / 86400. */
export function istDay(unixSeconds: number): number {
  return Math.floor((unixSeconds + 19_800) / 86_400);
}

/** Index the contracts use for each asset. */
export const ASSET_INDEX = Object.fromEntries(ASSETS.map((a) => [a.id, a.index])) as Record<AssetId, number>;

export const ASSET_IDS: readonly AssetId[] = ASSETS.map((a) => a.id);
