import { describe, expect, it } from "vitest";
import { displayMoney, displayMoneyDelta, formatE8, formatMoney, moneyTooltip, priceAge } from "./format";

const E8 = 100_000_000n;

describe("$ display rule (SPEC §3)", () => {
  const start = 1200n * E8; // START_CASH_E8 is set at deploy; any positive value works

  it("start value shows $100,000", () => {
    expect(displayMoney(start, start)).toBe(100_000);
    expect(formatMoney(displayMoney(start, start))).toBe("$100,000");
  });

  it("is 100000 × value / startValue", () => {
    expect(displayMoney((start * 10342n) / 10000n, start)).toBe(103_420);
    expect(displayMoney(start / 2n, start)).toBe(50_000);
    expect(displayMoney(0n, start)).toBe(0);
  });

  it("rounds to whole dollars, half away from zero", () => {
    // 100000 × 1 / 3 = 33333.33 → 33333; 100000 × 2 / 3 = 66666.67 → 66667
    expect(displayMoney(1n, 3n)).toBe(33_333);
    expect(displayMoney(2n, 3n)).toBe(66_667);
    // exactly .5 → up; negative .5 → down (away from zero)
    expect(displayMoney(1n, 200_000n)).toBe(1); // 0.5
    expect(displayMoney(-1n, 200_000n)).toBe(-1);
  });

  it("delta uses the same rule", () => {
    expect(displayMoneyDelta((start * 876n) / 1000n, start)).toBe(-12_400);
    expect(formatMoney(-12_400)).toBe("−$12,400");
    expect(formatMoney(3_420, { signed: true })).toBe("+$3,420");
  });

  it("rejects a zero start value", () => {
    expect(() => displayMoney(1n, 0n)).toThrow();
  });

  it("tooltip shows the exact on-chain play USDT behind the scaled figure", () => {
    expect(moneyTooltip(123456789012n)).toBe("On chain: 1,234.57 play USDT, scaled so every bot starts at $100,000");
  });
});

describe("formatE8", () => {
  it("formats 8-decimal fixed point", () => {
    expect(formatE8(6_392_295_000_000n)).toBe("63,922.95");
    expect(formatE8(254_321_000n, 4)).toBe("2.5432");
    expect(formatE8(-150_000_000n)).toBe("−1.50");
  });
});

describe("price-age label (SPEC §5.7)", () => {
  const now = 1_800_000_000_000; // ms
  const nowSec = now / 1000;

  it("< 60 min → 'Xm old', muted", () => {
    expect(priceAge("BTC", nowSec - 60, now)).toEqual({ tone: "muted", text: "1m old", stale: false });
    expect(priceAge("GOLD", nowSec - 59 * 60, now)).toEqual({ tone: "muted", text: "59m old", stale: false });
  });

  it("≥ 60 min → '<Asset> price Nh old', amber (gold only: crypto's limit is 30 min)", () => {
    expect(priceAge("GOLD", nowSec - 60 * 60, now)).toEqual({ tone: "amber", text: "Gold price 1h old", stale: false });
    expect(priceAge("GOLD", nowSec - 3 * 3600 - 120, now)).toEqual({ tone: "amber", text: "Gold price 3h old", stale: false });
  });

  it("past the asset's max age → 'Holding — price too old', grey", () => {
    expect(priceAge("BTC", nowSec - 1801, now)).toEqual({ tone: "grey", text: "Holding — price too old", stale: true });
    expect(priceAge("GOLD", nowSec - 21601, now)).toEqual({ tone: "grey", text: "Holding — price too old", stale: true });
  });

  it("exactly at the limit is still valid (contract check is age ≤ maxAge)", () => {
    expect(priceAge("ETH", nowSec - 1800, now).stale).toBe(false);
    expect(priceAge("GOLD", nowSec - 21600, now).tone).toBe("amber");
  });

  it("future timestamps (clock skew) read as 0m old", () => {
    expect(priceAge("SOL", nowSec + 30, now).text).toBe("0m old");
  });
});
