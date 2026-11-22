// TODO(#33): delete this file and import the same names from @botfolio/shared once relay.ts is on main.
import { ASSETS, qieMainnet, type AssetId } from "@botfolio/shared";
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

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

/** `IPaperLedger.ApprovedOrder`: a big move the runner signs and the owner submits. */
export interface ApprovedOrder extends LedgerOrder {
  /** uint64 unix seconds. */
  deadline: bigint;
}

export const APPROVED_ORDER_TYPES = {
  ApprovedOrder: [
    { name: "botId", type: "uint256" },
    { name: "asset", type: "uint8" },
    { name: "buy", type: "bool" },
    { name: "bps", type: "uint16" },
    { name: "decisionId", type: "bytes32" },
    { name: "actionIndex", type: "uint8" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export function paperLedgerDomain(verifyingContract: Address) {
  return { name: "BotFolio PaperLedger", version: "1", chainId: qieMainnet.id, verifyingContract } as const;
}

/** The bot's Daily Call view, signed by the runner (`IDailyCall`). */
export interface DailyCallBotView {
  botId: bigint;
  /** IST day number. */
  day: number;
  botUp: boolean;
}

/** On the wire: what the app passes to `DailyCall.call`. */
export interface SignedDailyCallBotView {
  botId: string;
  day: number;
  botUp: boolean;
  botSig: Hex;
}

export const DAILY_CALL_BOT_VIEW_TYPES = {
  BotView: [
    { name: "botId", type: "uint256" },
    { name: "day", type: "uint32" },
    { name: "botUp", type: "bool" },
  ],
} as const;

export function dailyCallDomain(verifyingContract: Address) {
  return { name: "BotFolio DailyCall", version: "1", chainId: qieMainnet.id, verifyingContract } as const;
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
