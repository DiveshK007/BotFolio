import { describe, expect, it } from "vitest";
import { fConsistency, fDrawdown, fExplains, fRules, namesAsset, reasonPasses, type ExecutedDecision } from "../../src/trust/rules";
import { trustLeaf } from "../../src/trust/scores";
import { merkleRoot } from "../../src/season/merkle";

const E8 = 100_000_000n;

describe("trust factors (SPEC §7)", () => {
  it("F1: clipped or dropped share of proposed actions, floored", () => {
    expect(fRules(0, 0)).toBe(250);
    expect(fRules(10, 0)).toBe(250);
    expect(fRules(10, 1)).toBe(225);
    expect(fRules(3, 1)).toBe(166); // 250 × 2/3 = 166.67
    expect(fRules(4, 4)).toBe(0);
    expect(fRules(2, 5)).toBe(0); // never below zero
  });

  it("F2: 30 % drawdown is 0, exact on the boundary", () => {
    expect(fDrawdown([]).valueOf()).toBe(250);
    expect(fDrawdown([100n * E8, 110n * E8, 120n * E8])).toBe(250);
    expect(fDrawdown([100n * E8, 70n * E8])).toBe(0); // exactly 30 %
    expect(fDrawdown([100n * E8, 85n * E8, 200n * E8])).toBe(125); // 15 % → half
    // The worst drop counts, not the biggest in value: 10/100 (10 %) is worse than 15/200 (7.5 %).
    expect(fDrawdown([100n * E8, 90n * E8, 200n * E8, 185n * E8])).toBe(166); // 250 × (1 − 0.1/0.3) = 166.67
    expect(fDrawdown([100n * E8, 60n * E8])).toBe(0);
  });

  it("F3: σ of daily returns, 125 with fewer than 3", () => {
    expect(fConsistency([])).toBe(125);
    expect(fConsistency([0.01, -0.01])).toBe(125);
    expect(fConsistency([0.01, 0.01, 0.01])).toBe(250);
    expect(fConsistency([0.02, -0.02, 0.02, -0.02])).toBe(125); // σ = 0.02
    expect(fConsistency([0.1, -0.1, 0.1])).toBe(0);
  });

  it("F4: valid share of executed decisions; none executed is 0", () => {
    expect(fExplains(0, 0)).toBe(0);
    expect(fExplains(3, 4)).toBe(187);
    expect(fExplains(4, 4)).toBe(250);
  });
});

describe("the F4 reason check", () => {
  const base: ExecutedDecision = {
    reason: "Adding a little BTC on strength.",
    reasonTag: "trend_up",
    trades: [{ asset: "BTC", side: "BUY" }],
    chg24hPct: { BTC: 2.1 },
  };

  it("passes a plain reason that names the traded asset", () => {
    expect(reasonPasses(base)).toBe(true);
    expect(reasonPasses({ ...base, reason: "Bitcoin looks strong today." })).toBe(true);
  });

  it("names assets as whole words, any case", () => {
    expect(namesAsset("Buying gold.", "GOLD")).toBe(true);
    expect(namesAsset("A golden chance", "GOLD")).toBe(false);
    expect(namesAsset("eth, sol and xrp", "SOL")).toBe(true);
    expect(namesAsset("console log", "SOL")).toBe(false);
  });

  it("fails on length, a missing asset name or an unknown tag", () => {
    expect(reasonPasses({ ...base, reason: "BTC up" })).toBe(false); // 6 chars
    expect(reasonPasses({ ...base, reason: `BTC ${"x".repeat(137)}` })).toBe(false); // 141 chars
    expect(reasonPasses({ ...base, reason: `BTC ${"x".repeat(136)}` })).toBe(true); // 140 chars
    expect(reasonPasses({ ...base, reason: "Feeling bullish about this one." })).toBe(false);
    expect(reasonPasses({ ...base, reasonTag: "moon" })).toBe(false);
    expect(reasonPasses({ ...base, reason: null })).toBe(false);
  });

  it("counts length in characters, not UTF-16 units", () => {
    expect(reasonPasses({ ...base, reason: `BTC ${"🚀".repeat(136)}` })).toBe(true);
  });

  it("checks the tag against the trades", () => {
    const sell = [{ asset: "BTC" as const, side: "SELL" as const }];
    expect(reasonPasses({ ...base, reasonTag: "take_profit" })).toBe(false);
    expect(reasonPasses({ ...base, reasonTag: "take_profit", trades: sell })).toBe(true);
    expect(reasonPasses({ ...base, reasonTag: "cut_loss", trades: sell })).toBe(true);
    expect(reasonPasses({ ...base, reasonTag: "buy_dip" })).toBe(false); // +2.1 % isn't a dip
    expect(reasonPasses({ ...base, reasonTag: "buy_dip", chg24hPct: { BTC: -1.5 } })).toBe(true);
    expect(reasonPasses({ ...base, reasonTag: "buy_dip", chg24hPct: { BTC: null } })).toBe(false);
    expect(reasonPasses({ ...base, reasonTag: "buy_dip", trades: sell, chg24hPct: { BTC: -3 } })).toBe(false);
    expect(reasonPasses({ ...base, reasonTag: "stay_cash" })).toBe(false);
    expect(reasonPasses({ ...base, reasonTag: "stay_cash", trades: sell })).toBe(true);
    expect(reasonPasses({ ...base, reasonTag: "rebalance", trades: sell })).toBe(true);
  });
});

describe("the score leaf", () => {
  // Vectors from packages/contracts/test/TrustScoreRegistry.t.sol.
  it("matches TrustScoreRegistry.leafHash and the contract test root", () => {
    const leaf = (bot: bigint, f: [number, number, number, number, number]) =>
      trustLeaf(3, bot, { fRules: f[0], fDrawdown: f[1], fConsistency: f[2], fExplains: f[3], total: f[4] });
    const leaves = [leaf(1n, [240, 200, 125, 250, 815]), leaf(2n, [250, 250, 250, 250, 1000]), leaf(3n, [0, 17, 99, 4, 120])];
    expect(leaves).toEqual([
      "0x028f844c6dfc35b2e05a38c1999a513aa7a3c402baef24404f13b0040a57c664",
      "0xf5fb168b0f752662c47d9dfaf40a64f885f554e0f3abdae613be2ba0379a6bef",
      "0xcbdc486bb67594a46746fb4539742a812fb939ec676722dc7667f47e8f31cec7",
    ]);
    expect(merkleRoot(leaves)).toBe("0xc59ae547a0bb58564c2bef1213088509f23b9f3d74f4791aab9fca584ed6b446");
  });
});
