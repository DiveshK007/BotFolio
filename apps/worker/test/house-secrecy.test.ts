import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/canonical";
import { gate } from "../src/gate/gate";
import { houseDecision, type HouseStrategy } from "../src/house/strategies";
import { gateInput, liveStalePrices, portfolio, prices } from "./helpers/fixtures";

// gate_result is public through site_decisions, and a Daily Call view is secret until the pick (SPEC §6.4.1).
describe.each<HouseStrategy>(["steady_sam", "gold_granny", "momentum_max"])("%s and the Daily Call secret", (strategy) => {
  const start = new Date("2026-11-24T00:00:00+05:30");
  const nine = new Date("2026-11-24T09:00:00+05:30"); // the slot where LLM bots return a view

  it.each([
    ["all fresh", prices()],
    ["only BTC and ETH fresh", liveStalePrices()],
  ])("%s: no view in the output or the gate result", (_name, p) => {
    for (const kind of ["scheduled", "debut"] as const) {
      const output = houseDecision({
        strategy,
        slot: { kind, time: nine },
        seasonStart: start,
        portfolio: portfolio(),
        prices: p,
        chg24hPct: { BTC: 3, SOL: 3 },
      });
      const result = gate(gateInput({ prices: p, bot: { isHouse: true } }), output, "gate-test");
      expect(result.status).not.toBe("invalid");
      expect(canonicalJson({ output, result })).not.toMatch(/daily_call|btc_up|botUp|bot_up/);
    }
  });

  it.each([true, false])("an injected view (btc_up=%s) is refused and leaves no trace", (btcUp) => {
    const output = houseDecision({
      strategy,
      slot: { kind: "scheduled", time: nine },
      seasonStart: start,
      portfolio: portfolio(),
      prices: prices(),
      chg24hPct: {},
    });
    const injected = { ...output, daily_call: { btc_up: btcUp, why: "hidden-why" } };
    const result = gate(gateInput({ bot: { isHouse: true } }), injected, "gate-test");
    expect(result.status).toBe("invalid");
    expect(canonicalJson(result)).not.toMatch(/daily_call|btc_up|hidden-why/);
  });
});
