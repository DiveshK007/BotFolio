import type { AssetId } from "@botfolio/shared";
import type { Hex } from "viem";
import type { DecisionOutput } from "../decision/schema";
import type { LedgerOrder, SkipReason } from "../interfaces";

export interface Portfolio {
  cashE8: bigint;
  unitsE18: Readonly<Record<AssetId, bigint>>;
}

export interface Price {
  /** Latest answer, even if too old. 0 when the feed can't be read. */
  priceE8: bigint;
  /** Valid and within max age (SPEC §5 rule 3). Only fresh assets trade. */
  fresh: boolean;
}

export interface GateBot {
  botId: bigint;
  active: boolean;
  maxPerCoinBps: number;
  maxTradesPerDay: number;
  /** For the current IST day. Get it with `tradesTodayFrom()`; the raw on-chain counter can be from an older day. */
  tradesToday: number;
}

/** Everything gate() needs. All of it is logged, so the replay script can re-run the gate. */
export interface GateInput {
  decisionId: Hex;
  bot: GateBot;
  portfolio: Portfolio;
  prices: Readonly<Record<AssetId, Price>>;
}

export type DropReason =
  | "inactive"
  | "stale"
  | "no_holding"
  | "low_cash"
  | "trade_limit"
  | "coin_cap"
  | "zero"
  | "min_order";

/**
 * What `PaperLedger.executeBatch` would emit in `OrderSkipped.reason` if the dropped order were sent anyway.
 * null = a gate-only rule: the contract would have accepted the order (SPEC §6.4 steps 3 and 6).
 */
export const LEDGER_EQUIVALENT: Readonly<Record<DropReason, SkipReason | null>> = {
  inactive: "INACTIVE",
  stale: "STALE",
  no_holding: "ZERO",
  low_cash: null,
  trade_limit: "LIMIT",
  coin_cap: "LIMIT",
  zero: "ZERO",
  min_order: null,
};

interface EventBase {
  actionIndex: number;
  asset: AssetId;
  action: "BUY" | "SELL";
  /** False for drops that aren't the bot's fault (stale price, paused bot). See trust factor F1 (SPEC §7). */
  countsForF1: boolean;
}

/** SPEC §6.4 step 7: every clip and drop is recorded. */
export type GateEvent =
  | (EventBase & { kind: "drop"; reason: DropReason })
  | (EventBase & { kind: "clip"; reason: "coin_cap"; fromBps: number; toBps: number });

export interface GateOrder extends LedgerOrder {
  orderId: Hex;
}

export type DecisionStatus = "executed" | "held" | "skipped_stale" | "invalid";

export interface GateResult {
  rulesVersion: string;
  status: DecisionStatus;
  /** In execution order, ready for `executeBatch`. */
  orders: GateOrder[];
  events: GateEvent[];
  /** BUY and SELL actions the bot proposed (HOLD is not a proposal). */
  proposedActions: number;
  output: DecisionOutput | null;
  /** Why the output failed the schema. Empty unless status is `invalid`. */
  errors: string[];
}
