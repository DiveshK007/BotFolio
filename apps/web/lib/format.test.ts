import { describe, expect, it } from "vitest";
import { displayInr, displayInrDelta, formatE8, formatInr, inrTooltip, priceAge } from "./format";

const E8 = 100_000_000n;

describe("₹ display rule (SPEC §3)", () => {
  const start = 1200n * E8; // START_CASH_E8 is set at deploy; any positive value works

  it("start value shows ₹1,00,000", () => {
    expect(displayInr(start, start)).toBe(100_000);
    expect(formatInr(displayInr(start, start))).toBe("₹1,00,000");
  });

  it("is 100000 × value / startValue", () => {
    expect(displayInr((start * 10342n) / 10000n, start)).toBe(103_420);
    expect(displayInr(start / 2n, start)).toBe(50_000);
    expect(displayInr(0n, start)).toBe(0);
  });

  it("rounds to whole rupees, half away from zero", () => {
    // 100000 × 1 / 3 = 33333.33 → 33333; 100000 × 2 / 3 = 66666.67 → 66667
    expect(displayInr(1n, 3n)).toBe(33_333);
    expect(displayInr(2n, 3n)).toBe(66_667);
    // exactly .5 → up; negative .5 → down (away from zero)
    expect(displayInr(1n, 200_000n)).toBe(1); // 0.5
    expect(displayInr(-1n, 200_000n)).toBe(-1);
  });

  it("delta uses the same rule", () => {
    expect(displayInrDelta((start * 876n) / 1000n, start)).toBe(-12_400);
    expect(formatInr(-12_400)).toBe("−₹12,400");
    expect(formatInr(3_420, { signed: true })).toBe("+₹3,420");
  });

  it("rejects a zero start value", () => {
    expect(() => displayInr(1n, 0n)).toThrow();
  });

  it("tooltip shows the USDT value and says INR is approximate", () => {
    expect(inrTooltip(123456789012n)).toBe("≈ 1,234.57 USDT; INR conversion approximate");
    expect(inrTooltip(123456789012n, null)).toBe("≈ 1,234.57 USDT; INR conversion approximate");
  });

  it("tooltip adds today's USD/INR rate when the worker sent one", () => {
    expect(inrTooltip(123456789012n, 92.92)).toBe("≈ 1,234.57 USDT; INR conversion approximate (1 USD ≈ ₹92.92 today)");
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
