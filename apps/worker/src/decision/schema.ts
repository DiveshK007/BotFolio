import type { JsonSchema } from "@botfolio/llm";
import type { AssetId } from "@botfolio/shared";

export const REASON_TAGS = [
  "trend_up",
  "trend_down",
  "buy_dip",
  "take_profit",
  "cut_loss",
  "rebalance",
  "persona_preference",
  "coach_feedback",
  "stay_cash",
] as const;
export type ReasonTag = (typeof REASON_TAGS)[number];

export type ActionKind = "BUY" | "SELL" | "HOLD";

export interface DecisionAction {
  asset: AssetId;
  action: ActionKind;
  /** BUY: % of current cash. SELL: % of the current holding (SPEC §6.3). */
  pct: number;
}

export interface DecisionOutput {
  actions: DecisionAction[];
  reason: string;
  reason_tag: ReasonTag;
  roast: string;
  /** Returned at the 09:00 slot and on the debut decision (SPEC §6.4.1). */
  daily_call?: { btc_up: boolean; why: string };
}

/** SPEC §6.3, word for word. A test compares this object with the JSON block in SPEC.md. */
export const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["actions", "reason", "reason_tag", "roast"],
  properties: {
    actions: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["asset", "action", "pct"],
        properties: {
          asset: { enum: ["BTC", "ETH", "SOL", "XRP", "GOLD"] },
          action: { enum: ["BUY", "SELL", "HOLD"] },
          pct: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
    },
    reason: { type: "string", minLength: 10, maxLength: 140 },
    reason_tag: { enum: REASON_TAGS },
    roast: { type: "string", maxLength: 100 },
  },
} satisfies JsonSchema;

const DAILY_CALL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["btc_up", "why"],
  properties: { btc_up: { type: "boolean" }, why: { type: "string", maxLength: 80 } },
} satisfies JsonSchema;

/** What gate() accepts from the log: §6.3 plus the optional `daily_call` of §6.4.1. */
export const DECISION_OUTPUT_SCHEMA = {
  ...DECISION_SCHEMA,
  properties: { ...DECISION_SCHEMA.properties, daily_call: DAILY_CALL_SCHEMA },
} satisfies JsonSchema;
