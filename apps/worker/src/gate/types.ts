import type { AssetId } from "@botfolio/shared";
import type { Hex } from "viem";
import type { BigMoveConfig } from "../config";
import type { DecisionOutput } from "../decision/schema";
import type { HouseOutput } from "../house/schema";
import type { ApprovedOrder, LedgerOrder, SkipReason } from "../interfaces";
import type { TextFlag } from "./filter-output";

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
  /** House bots log `HouseOutput` (bps) and never produce big moves (SPEC §6.4 step 9). */
  isHouse: boolean;
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
  /** Decision time. Only used for big-move deadlines; passed in so the gate stays pure. */
  nowSeconds: number;
  /** From env via `loadBigMoveConfig()`. Logged with the input so a replay uses the same thresholds. */
  bigMove: BigMoveConfig;
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
 * What `PaperLedger.executeBatch` would emit in `OrderSkipped.reason` for an order whose only problem is
 * this one. null = a gate-only rule, the contract accepts the order (SPEC §6.4 steps 3 and 6).
 * With several problems at once the two can name different ones: the contract checks trades/day before
 * the holding, while §6.4 checks the holding (step 3) before trades/day (step 4).
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

/** An order pulled out of the batch for the owner to allow (SPEC §6.4 step 9). Becomes a `big_moves` row. */
export interface BigMove {
  order: ApprovedOrder;
  orderId: Hex;
  /** Weight the asset would have after this trade, for "wants to put 35 % in Gold. Allow?". */
  postWeightBps: number;
}

export type DecisionStatus = "executed" | "held" | "skipped_stale" | "invalid";

export interface GateResult {
  rulesVersion: string;
  status: DecisionStatus;
  /** In execution order, ready for `executeBatch`. */
  orders: GateOrder[];
  /** Not in `orders`, so not in `executeBatch`. The runner signs each one and asks the owner. */
  bigMoves: BigMove[];
  events: GateEvent[];
  /** BUY and SELL actions the bot proposed (HOLD is not a proposal). */
  proposedActions: number;
  /**
   * The validated output after the content filter (step 8). Show and store text from here, not from the raw output.
   * Never has `daily_call`: this whole object is stored as the public `gate_result`. Sign and serve the view from
   * the decision output, through `filterOutput()`, and only after the user picks (SPEC §6.4.1).
   */
  output: Omit<DecisionOutput, "daily_call"> | Omit<HouseOutput, "daily_call"> | null;
  /** What the content filter replaced. Not a clip: no F1 penalty. */
  textFlags: TextFlag[];
  /** Why the output failed the schema. Empty unless status is `invalid`. */
  errors: string[];
}
