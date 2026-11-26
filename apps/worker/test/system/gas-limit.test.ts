import { describe, expect, it } from "vitest";
import { gasLimit } from "../../src/system/sender";
import { executeBatchMinGas } from "../../src/slot/chain";

describe("gas limit (#337)", () => {
  it("pads the estimate when it is above the floor", () => {
    expect(gasLimit(120_000n)).toBe(165_000n);
    expect(gasLimit(400_000n, executeBatchMinGas(1))).toBe(515_000n);
  });
  it("never sends executeBatch below the per-order floor, whatever the estimate", () => {
    expect(gasLimit(22_364n, executeBatchMinGas(1))).toBe(190_000n); // the Nov 26 debut: 42,955 ran out of gas
    expect(executeBatchMinGas(50)).toBe(6_560_000n);
  });
});
