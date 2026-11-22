import type { JsonSchema } from "@botfolio/llm";
import type { AssetId } from "@botfolio/shared";
import { DECISION_SCHEMA, type ActionKind, type ReasonTag } from "../decision/schema";

export interface HouseAction {
  asset: AssetId;
  action: ActionKind;
  /**
   * BUY: share of cash when it runs. SELL: share of the holding. Basis points, because whole percents
   * can't split cash five ways (the third buy of five needs 33.33 % of what is left).
   */
  bps: number;
}

/** What a house bot logs as its output. gate() validates it, so a replay treats it like an LLM decision. */
export interface HouseOutput {
  /**
   * One entry per asset the strategy covers, always in the same order, HOLDs included. That keeps
   * `actionIndex`, and so the orderId, the same when a stale asset is retried at +5/+10/+15 min.
   */
  actions: HouseAction[];
  reason: string;
  reason_tag: ReasonTag;
  roast: string;
  /** House bots have no Daily Call. */
  daily_call?: undefined;
}

export const HOUSE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: DECISION_SCHEMA.required,
  properties: {
    ...DECISION_SCHEMA.properties,
    actions: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["asset", "action", "bps"],
        properties: {
          asset: DECISION_SCHEMA.properties.actions.items.properties.asset,
          action: DECISION_SCHEMA.properties.actions.items.properties.action,
          bps: { type: "integer", minimum: 0, maximum: 10_000 },
        },
      },
    },
  },
} satisfies JsonSchema;
