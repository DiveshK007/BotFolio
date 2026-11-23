import type { JsonSchema } from "@botfolio/llm";
import { LIMITS } from "../persona/schema";

export const MAX_CHANGES = 5;

export interface V2Output {
  rules: string;
  max_per_coin_pct: number;
  max_trades_per_day: number;
  changes: { what: string; because_correction_id: number }[];
}

/**
 * SPEC §6.3: `{rules ≤ 240, max_per_coin_pct, max_trades_per_day, changes:[{what, because_correction_id}] ≤ 5}`.
 * `because_correction_id` is 0 for a change made from the season's results (no correction behind it): a nullable
 * type in strict mode is UNVERIFIED for xAI, an integer is not.
 */
export const V2_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rules", "max_per_coin_pct", "max_trades_per_day", "changes"],
  properties: {
    rules: { type: "string", maxLength: 240 },
    max_per_coin_pct: { type: "integer", enum: [10, 15, 20, 25, 30, 35, 40, 45, 50] },
    max_trades_per_day: { type: "integer", minimum: LIMITS.tradesPerDay.min, maximum: LIMITS.tradesPerDay.max },
    changes: {
      type: "array",
      maxItems: MAX_CHANGES,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["what", "because_correction_id"],
        properties: {
          what: { type: "string", maxLength: 100 },
          because_correction_id: { type: "integer", minimum: 0 },
        },
      },
    },
  },
} satisfies JsonSchema;
