import type { Hex } from "viem";
import { hashJson } from "../canonical";
import type { Persona } from "../persona/persona";
import type { HouseStrategy } from "./strategies";

export interface HousePersona {
  strategy: HouseStrategy;
  persona: Persona;
  maxPerCoinBps: number;
  maxTradesPerDay: number;
}

/**
 * The three house bots (SPEC §8), in the order they are created on-chain (botIds 1–3 on a fresh registry).
 * `persona.name` is what `slot/bots.ts` maps to a strategy, so it must stay exactly these names.
 * The personaHash on-chain is hashJson(persona), the same hashing as a user's bot.
 */
export const HOUSE_PERSONAS: readonly HousePersona[] = [
  {
    strategy: "steady_sam",
    persona: {
      name: "Steady Sam",
      emoji: "🐢",
      persona: "Calm and patient. Splits the money evenly across all five assets and leaves it alone.",
      rules: "20% each in BTC, ETH, SOL, XRP and Gold, rebalanced once a season. Never makes big moves.",
    },
    maxPerCoinBps: 2500,
    maxTradesPerDay: 8,
  },
  {
    strategy: "gold_granny",
    persona: {
      name: "Gold Granny",
      emoji: "👵",
      persona: "Old-school and careful. Trusts gold and keeps the rest in cash.",
      rules: "50% Gold, 50% cash, rebalanced once a season. Never makes big moves.",
    },
    maxPerCoinBps: 5000,
    maxTradesPerDay: 4,
  },
  {
    strategy: "momentum_max",
    persona: {
      name: "Momentum Max",
      emoji: "🚀",
      persona: "Chases whatever is moving. Buys strength and dumps weakness.",
      rules: "Each slot: holds assets up more than 2% in 24 h (up to 25% each) and sells those down more than 2%.",
    },
    maxPerCoinBps: 2500,
    maxTradesPerDay: 8,
  },
];

export const housePersonaHash = (house: HousePersona): Hex => hashJson(house.persona);
