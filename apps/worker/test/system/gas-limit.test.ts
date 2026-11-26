import { describe, expect, it } from "vitest";
import { gasLimit, SYSTEM_MIN_GAS } from "../../src/system/sender";
import { isBogusEstimate } from "../../src/relay/chain";
import { executeBatchMinGas } from "../../src/slot/chain";
import { closeSeasonMinGas } from "../../src/seasons/ledger";

describe("gas limit (#337)", () => {
  it("pads the estimate when it is above the floor", () => {
    expect(gasLimit(120_000n)).toBe(165_000n);
    expect(gasLimit(400_000n, executeBatchMinGas(1))).toBe(515_000n);
  });
  it("never sends executeBatch below the per-order floor, whatever the estimate", () => {
    expect(gasLimit(22_364n, executeBatchMinGas(1))).toBe(190_000n); // the Nov 26 debut: 42,955 ran out of gas
    expect(executeBatchMinGas(50)).toBe(6_560_000n);
  });

  it("never sends closeSeason below what its dataURI costs to store (#152)", () => {
    const uri = (bytes: number) => "x".repeat(bytes);
    // Measured on a fork of the deployed SeasonLedger, sent with a bare-intrinsic estimate.
    expect(gasLimit(22_000n, closeSeasonMinGas(uri(85)))).toBeGreaterThan(167_403n);
    expect(gasLimit(22_000n, closeSeasonMinGas(uri(265)))).toBeGreaterThan(305_025n);
  });

  it("floors every system tx and spots a bare-intrinsic estimate (#339)", () => {
    expect(gasLimit(21_544n)).toBe(SYSTEM_MIN_GAS); // S0's openSeason: 41,930 ran out of gas
    expect(isBogusEstimate(21_544n, 21_544n)).toBe(true);
    expect(isBogusEstimate(45_186n, 21_640n)).toBe(false); // a skipped 1-order batch, measured on QIE
    expect(isBogusEstimate(71_336n, 21_544n)).toBe(false); // openSeason, measured on QIE
  });
});
