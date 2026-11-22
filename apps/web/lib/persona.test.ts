import { describe, expect, it } from "vitest";
import { parsePersonaDraft, validLimits } from "./persona";

const hash = `0x${"ab".repeat(32)}`;
const persona = {
  name: "GoldGuru",
  emoji: "🪙",
  persona: "Careful, like your dad",
  rules: "Mostly gold. Never all in.",
  max_per_coin_pct: 25,
  max_trades_per_day: 4,
};
const body = (change: object = {}) => ({ personaHash: hash, persona: { ...persona, ...change } });

describe("parsePersonaDraft (SPEC §6.3)", () => {
  it("reads a valid persona", () => {
    expect(parsePersonaDraft(body())).toEqual({
      personaHash: hash,
      persona: {
        name: "GoldGuru",
        emoji: "🪙",
        persona: "Careful, like your dad",
        rules: "Mostly gold. Never all in.",
        limits: { maxPerCoinPct: 25, maxTradesPerDay: 4 },
      },
    });
  });

  it("accepts both ends of both sliders", () => {
    expect(parsePersonaDraft(body({ max_per_coin_pct: 10, max_trades_per_day: 1 }))).not.toBeNull();
    expect(parsePersonaDraft(body({ max_per_coin_pct: 50, max_trades_per_day: 8 }))).not.toBeNull();
  });

  it.each([
    { max_per_coin_pct: 5 },
    { max_per_coin_pct: 55 },
    { max_per_coin_pct: 27 },
    { max_per_coin_pct: "25" },
    { max_trades_per_day: 0 },
    { max_trades_per_day: 9 },
    { max_trades_per_day: 2.5 },
    { name: "x".repeat(21) },
    { name: "  " },
    { persona: "x".repeat(121) },
    { rules: "x".repeat(241) },
    { emoji: undefined },
  ])("rejects, and never clamps, %j", (change) => {
    expect(parsePersonaDraft(body(change))).toBeNull();
  });

  it("counts code points, like JSON Schema", () => {
    expect(parsePersonaDraft(body({ name: "🦁".repeat(20) }))).not.toBeNull();
  });

  it("rejects a missing or malformed hash", () => {
    expect(parsePersonaDraft({ persona })).toBeNull();
    expect(parsePersonaDraft({ persona, personaHash: "0x1234" })).toBeNull();
    expect(parsePersonaDraft(null)).toBeNull();
  });

  it("validLimits uses the same bounds", () => {
    expect(validLimits({ maxPerCoinPct: 35, maxTradesPerDay: 8 })).toBe(true);
    expect(validLimits({ maxPerCoinPct: 33, maxTradesPerDay: 8 })).toBe(false);
  });
});
