import type { LlmUsage } from "./types";

/** USD per 1M tokens. */
export interface ModelPrice {
  inPerM: number;
  outPerM: number;
}

/**
 * Defaults copied from SPEC §6.6 (xAI pricing page, last updated Oct 10 2026).
 * Not re-checked against the live page — UNVERIFIED. Unknown models are charged at the
 * most expensive rate here, so the budget guard errs on the side of resting early.
 */
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "grok-4.20-0309-non-reasoning": { inPerM: 1.25, outPerM: 2.5 },
  "grok-4.7": { inPerM: 2, outPerM: 6 },
  // Anthropic list price for prompts up to 100K tokens, from the Claude API reference (cached Nov 3 2026).
  "claude-haiku-5-5": { inPerM: 0.1, outPerM: 0.5 },
};

export function estimateCostUsd(model: string, usage: LlmUsage, prices: Record<string, ModelPrice> = DEFAULT_PRICES): number {
  const price = prices[model] ?? mostExpensive(prices);
  return (usage.inTok * price.inPerM + usage.outTok * price.outPerM) / 1_000_000;
}

function mostExpensive(prices: Record<string, ModelPrice>): ModelPrice {
  let worst: ModelPrice = { inPerM: 0, outPerM: 0 };
  for (const p of Object.values(prices)) {
    if (p.inPerM + p.outPerM > worst.inPerM + worst.outPerM) worst = p;
  }
  return worst;
}

/**
 * SPEC §6.6 budget rule: at 80 % of `LLM_MONTHLY_BUDGET_USD` → alert; at 100 % → bots fall back to
 * the deterministic hold ("bot resting"). The cap value is an open decision (SPEC §15 #1, Divesh),
 * so it only ever comes from env; unset means no cap is enforced yet.
 */
export type BudgetState = "uncapped" | "ok" | "alert" | "resting";

export function budgetState(spentUsd: number, capUsd: number | null): BudgetState {
  if (capUsd === null) return "uncapped";
  if (spentUsd >= capUsd) return "resting";
  if (spentUsd >= capUsd * 0.8) return "alert";
  return "ok";
}
