import type { AssetId } from "@botfolio/shared";
import type { DecisionOutput } from "../decision/schema";
import { bannedRules, type BannedRule } from "../text/content-filter";

export interface TextFlag {
  field: "reason" | "roast" | "daily_call.why";
  rule: BannedRule;
}

export const NEUTRAL_ROAST = "No roast this time.";
export const NEUTRAL_WHY = "Reason hidden.";

/** Neutral, 10–140 chars, and it names the traded assets, as trust factor F4 expects of a reason. */
export function neutralReason(traded: readonly AssetId[]): string {
  const names = [...new Set(traded)].map((a) => (a === "GOLD" ? "Gold" : a));
  const what = names.length > 0 ? `Picked ${names.join(", ")} this slot` : "Holding this slot";
  return `${what}. (Original note hidden.)`;
}

/**
 * SPEC §6.4 step 8. Returns a copy with banned text replaced, plus a flag per broken rule.
 * The copy replaces the raw text in the gate result on purpose: `gate_result` is publicly readable
 * (`site_decisions`), so it must not carry the text we just hid. Orders are never affected.
 */
export function filterOutput<T extends Pick<DecisionOutput, "reason" | "roast" | "daily_call">>(
  output: T,
  traded: readonly AssetId[],
): { output: T; textFlags: TextFlag[] } {
  const textFlags: TextFlag[] = [];
  const clean = (field: TextFlag["field"], text: string, replacement: string) => {
    const rules = bannedRules(text);
    for (const rule of rules) textFlags.push({ field, rule });
    return rules.length > 0 ? replacement : text;
  };

  const filtered: T = {
    ...output,
    reason: clean("reason", output.reason, neutralReason(traded)),
    roast: clean("roast", output.roast, NEUTRAL_ROAST),
  };
  if (output.daily_call) {
    filtered.daily_call = { ...output.daily_call, why: clean("daily_call.why", output.daily_call.why, NEUTRAL_WHY) };
  }
  return { output: filtered, textFlags };
}
