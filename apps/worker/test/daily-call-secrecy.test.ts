import { FakeLlmClient, loadLlmConfig } from "@botfolio/llm";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/canonical";
import { runDecisionCall } from "../src/decision/call";
import { buildDecisionInput } from "../src/decision/input";
import { gate } from "../src/gate/gate";
import { E8, decision, gateInput, portfolio, prices } from "./helpers/fixtures";

// SPEC §6.4.1: the bot's view is secret until the user picks. gate_result is public (site_decisions) and
// server logs are not a place for secrets, so neither may hold the view or anything computed from it.
const NINE = { kind: "scheduled" as const, time: new Date("2026-11-23T09:00:00+05:30") };
const INPUT = buildDecisionInput({
  slotTime: NINE.time,
  bot: { name: "Wolf", persona: "Bold.", rules: "Momentum.", maxPerCoinBps: 2500, maxTradesPerDay: 4, tradesToday: 0, version: 1 },
  portfolio: portfolio(),
  startValueE8: 1000n * E8,
  avgEntryE8: {},
  prices: prices(),
  changes: {},
  recentCorrections: [],
});
const withView = (btc_up: boolean, why: string) => ({ ...decision(), daily_call: { btc_up, why } });

async function logFor(replies: object[]): Promise<string> {
  const lines: string[] = [];
  await runDecisionCall({
    llm: new FakeLlmClient(replies),
    config: loadLlmConfig({}),
    input: INPUT,
    slot: NINE,
    budget: "ok",
    logLine: (line) => lines.push(line),
  });
  return lines.join("\n");
}

describe("the gate result doesn't depend on the Daily Call view", () => {
  it.each([
    ["the direction", withView(true, "Momentum"), withView(false, "Momentum")],
    ["a why the filter would flag", withView(true, "Momentum"), withView(true, "guaranteed profit")],
    ["having a view at all", decision(), withView(false, "you should sell now")],
  ])("same result whatever %s", (_name, a, b) => {
    const result = (output: object) => canonicalJson(gate(gateInput(), output, "gate-test"));
    expect(result(b)).toBe(result(a));
  });
});

describe("the decision log line doesn't depend on the Daily Call view", () => {
  it("same line for up and down: no output hash, no output token count", async () => {
    // An empty why is valid, so with a hash two guesses would give the answer away.
    expect(await logFor([withView(false, "")])).toBe(await logFor([withView(true, "")]));
  });

  it("same line whatever the why", async () => {
    expect(await logFor([withView(true, "Dips get bought, again and again and again.")])).toBe(
      await logFor([withView(true, "")]),
    );
  });

  it("a failed call doesn't echo a key the model wrote", async () => {
    const line = await logFor([{ ...decision(), daily_call: { btc_up: true, why: "", btc_will_rise: true } }]);
    expect(line).not.toContain("btc_will_rise");
    expect(line).toContain("schema_mismatch");
  });
});
