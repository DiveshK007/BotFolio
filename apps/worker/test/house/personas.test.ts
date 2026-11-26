import { describe, expect, it } from "vitest";
import { HOUSE_PERSONAS, housePersonaHash } from "../../src/house/personas";
import { houseStrategy } from "../../src/slot/bots";

describe("house personas (#28)", () => {
  it("each name is the one the runner maps to its strategy", () => {
    for (const house of HOUSE_PERSONAS) expect(houseStrategy(house.persona.name)).toBe(house.strategy);
  });

  it("limits are inside BotRegistry's bounds (10-50 % per coin, 1-8 trades a day)", () => {
    for (const { maxPerCoinBps, maxTradesPerDay } of HOUSE_PERSONAS) {
      expect(maxPerCoinBps).toBeGreaterThanOrEqual(1000);
      expect(maxPerCoinBps).toBeLessThanOrEqual(5000);
      expect(maxTradesPerDay).toBeGreaterThanOrEqual(1);
      expect(maxTradesPerDay).toBeLessThanOrEqual(8);
    }
  });

  // Once on mainnet these hashes are permanent: changing a persona's text needs a new house bot.
  it("persona hashes are pinned", () => {
    expect(HOUSE_PERSONAS.map(housePersonaHash)).toEqual([
      "0x548b5da29d22c6d7513bd544ba2d871fb3f5830cd7e33639f423bbb8fc0e64c0",
      "0xbfb0173cfd80ea69c316c03ff3e078a6d043a531a54c4a02bd3ecd916586962b",
      "0x25c397c63d1ce5db2e979fbcc19256c57497b09172b53d2cd40917480e2c2c79",
    ]);
  });
});
