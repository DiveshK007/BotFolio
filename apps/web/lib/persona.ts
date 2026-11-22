import type { Hex } from "viem";

/** Slider bounds (SPEC §2.1 step 3, same as BotRegistry.createBot in §4.2). */
export const PER_COIN_PCT = { min: 10, max: 50, step: 5 } as const;
export const TRADES_PER_DAY = { min: 1, max: 8, step: 1 } as const;

export interface BotLimits {
  maxPerCoinPct: number;
  maxTradesPerDay: number;
}

/** SPEC §6.3 persona schema. Every string is LLM output from user text, so untrusted (#159). */
export interface Persona {
  name: string;
  emoji: string;
  persona: string;
  rules: string;
  limits: BotLimits;
}

/** What S2 needs from the persona call: the card plus the hash the user signs in createBot. */
export interface PersonaDraft {
  persona: Persona;
  personaHash: Hex;
}

type Range = { min: number; max: number; step: number };
const inRange = (n: unknown, r: Range): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= r.min && n <= r.max && (n - r.min) % r.step === 0;

// JSON Schema maxLength counts code points, not UTF-16 units.
const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim() !== "" && [...v].length <= max;

export const validLimits = (l: BotLimits) =>
  inRange(l.maxPerCoinPct, PER_COIN_PCT) && inRange(l.maxTradesPerDay, TRADES_PER_DAY);

/** null for anything off-schema. We never clamp or fill in: the user would be signing values nobody generated. */
export function parsePersonaDraft(body: unknown): PersonaDraft | null {
  if (typeof body !== "object" || body === null) return null;
  const { persona, personaHash } = body as { persona?: unknown; personaHash?: unknown };
  if (typeof personaHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(personaHash)) return null;
  if (typeof persona !== "object" || persona === null) return null;

  const p = persona as Record<string, unknown>;
  // UNVERIFIED: §6.3 gives emoji no max length. 16 fits the longest flag and family sequences.
  if (!isText(p.name, 20) || !isText(p.emoji, 16) || !isText(p.persona, 120) || !isText(p.rules, 240)) return null;
  if (!inRange(p.max_per_coin_pct, PER_COIN_PCT) || !inRange(p.max_trades_per_day, TRADES_PER_DAY)) return null;

  return {
    personaHash: personaHash as Hex,
    persona: {
      name: p.name,
      emoji: p.emoji,
      persona: p.persona,
      rules: p.rules,
      limits: { maxPerCoinPct: p.max_per_coin_pct, maxTradesPerDay: p.max_trades_per_day },
    },
  };
}
