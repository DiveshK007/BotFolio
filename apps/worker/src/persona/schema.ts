import type { JsonSchema } from "@botfolio/llm";

export const LIMITS = {
  perCoinBps: { min: 1000, max: 5000, step: 500 },
  tradesPerDay: { min: 1, max: 8 },
} as const;

export interface PersonaOutput {
  name: string;
  emoji: string;
  persona: string;
  rules: string;
  max_per_coin_pct: number;
  max_trades_per_day: number;
}

/**
 * SPEC §6.3: `{name ≤ 20, emoji, persona ≤ 120, rules ≤ 240, max_per_coin_pct 10–50 step 5, max_trades_per_day 1–8}`.
 * "Step 5" is an enum because `multipleOf` support in strict mode is UNVERIFIED.
 */
export const PERSONA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "emoji", "persona", "rules", "max_per_coin_pct", "max_trades_per_day"],
  properties: {
    name: { type: "string", maxLength: 20 },
    emoji: { type: "string" },
    persona: { type: "string", maxLength: 120 },
    rules: { type: "string", maxLength: 240 },
    max_per_coin_pct: { type: "integer", enum: [10, 15, 20, 25, 30, 35, 40, 45, 50] },
    max_trades_per_day: { type: "integer", minimum: LIMITS.tradesPerDay.min, maximum: LIMITS.tradesPerDay.max },
  },
} satisfies JsonSchema;
