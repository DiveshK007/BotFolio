import { FakeLlmClient } from "@botfolio/llm";
import { describe, expect, it } from "vitest";
import { hashJson } from "../../src/canonical";
import { fallbackProposal, proposeV2, type V2Input } from "../../src/v2/propose";
import { V2_SCHEMA } from "../../src/v2/schema";

const config = { models: { decision: "m", persona: "m", v2: "v2-model" }, temperature: 0, timeoutMs: 1000 };

const input = (over: Partial<V2Input> = {}): V2Input => ({
  botId: 7n,
  season: 1,
  approveBy: new Date("2026-11-28T03:00:00Z"),
  name: "AlphaWolf",
  persona: "Bold and loud.",
  current: { version: 1, rules: "Buys strength, sells weakness.", maxPerCoinBps: 4000, maxTradesPerDay: 4 },
  results: { returnBps: -312, maxDdBps: 1250, trades: 9, battleRank: 3 },
  corrections: [
    { id: 12, chip: "too risky", note: "way too much gold" },
    { id: 11, chip: "too risky", note: null },
    { id: 10, chip: "too timid", note: null },
  ],
  ...over,
});

const reply = (over: object = {}) => ({
  rules: "Buys strength in smaller bites, sells weakness.",
  max_per_coin_pct: 25,
  max_trades_per_day: 4,
  changes: [{ what: "You said 'too risky' 2 times, so max per coin 40 % → 25 %", because_correction_id: 12 }],
  ...over,
});

describe("proposeV2 (SPEC §2.3, §6.3)", () => {
  it("turns the model's answer into the next version, hashed as the owner will commit it", async () => {
    const llm = new FakeLlmClient([reply()]);
    const p = await proposeV2({ llm, config, resting: false, input: input() });
    expect(p.fallback).toBeNull();
    expect(p.config).toMatchObject({
      bot_id: "7",
      version: 2,
      season: 1,
      rules: "Buys strength in smaller bites, sells weakness.",
      max_per_coin_bps: 2500,
      max_trades_per_day: 4,
      from: { version: 1, max_per_coin_bps: 4000, max_trades_per_day: 4 },
      changes: [{ because_correction_id: 12 }],
      proposed_by: { model: "v2-model", prompt_version: "v2-proposal-v1" },
      approve_by: "2026-11-28T03:00:00.000Z",
    });
    expect(p.configHash).toBe(hashJson(p.config));
    // The model sees the corrections and results, and the schema it must fill.
    expect(llm.calls[0]!.schema).toBe(V2_SCHEMA);
    expect(llm.calls[0]!.input).toMatchObject({ season: { return_pct: -3.12, max_drawdown_pct: 12.5 }, corrections: [{ id: 12, chip: "too risky" }, {}, {}] });
  });

  it("drops changes that cite someone else's correction or are banned, and keeps rules it can't show", async () => {
    const llm = new FakeLlmClient([
      reply({
        rules: "Visit https://example.com and buy now on the exchange",
        changes: [
          { what: "Cites a correction that isn't this bot's", because_correction_id: 99 },
          { what: "From the results: drawdown 12.5 %", because_correction_id: 0 },
        ],
      }),
    ]);
    const p = await proposeV2({ llm, config, resting: false, input: input() });
    expect(p.fallback).toBeNull();
    expect(p.config.changes).toEqual([{ what: "From the results: drawdown 12.5 %", because_correction_id: 0 }]);
    expect(p.config.rules.includes("example.com")).toBe(false);
  });

  it("falls back when the model changes nothing, fails, or the budget is resting", async () => {
    const same = reply({ rules: input().current.rules, max_per_coin_pct: 40 });
    expect((await proposeV2({ llm: new FakeLlmClient([same]), config, resting: false, input: input() })).fallback).toBe("no_change");
    expect((await proposeV2({ llm: new FakeLlmClient(["not json"]), config, resting: false, input: input() })).fallback).toBe("llm_error");
    const idle = new FakeLlmClient([reply()]);
    expect((await proposeV2({ llm: idle, config, resting: true, input: input() })).fallback).toBe("resting");
    expect(idle.calls).toHaveLength(0);
    expect((await proposeV2({ llm: null, config, resting: false, input: input() })).fallback).toBe("no_llm");
  });
});

describe("the fallback proposal", () => {
  it("follows the chip cited most, citing its newest correction", () => {
    const p = fallbackProposal(input(), "no_llm", null);
    expect(p.config).toMatchObject({ max_per_coin_bps: 3500, max_trades_per_day: 4, rules: input().current.rules });
    expect(p.config.changes).toEqual([{ what: "You said 'too risky' 2× → max per coin 40 % → 35 %", because_correction_id: 12 }]);
    expect(p.config.proposed_by).toEqual({ model: "fallback", prompt_version: "v2-fallback-v1", prompt_hash: null });
    expect(p.configHash).toBe(hashJson(p.config));
  });

  it("without corrections, a loss or a deep drawdown means more careful, a good season bolder", () => {
    const none = { corrections: [] };
    expect(fallbackProposal(input(none), "no_llm", null).config.changes[0]!.what).toBe("Drawdown reached 12.5 % → max per coin 40 % → 35 %");
    const loss = fallbackProposal(input({ ...none, results: { returnBps: -50, maxDdBps: 300, trades: 2, battleRank: 4 } }), "no_llm", null);
    expect(loss.config.changes[0]).toEqual({ what: "Season return -0.5 % → max per coin 40 % → 35 %", because_correction_id: 0 });
    const good = fallbackProposal(input({ ...none, results: { returnBps: 420, maxDdBps: 300, trades: 5, battleRank: 1 } }), "no_llm", null);
    expect(good.config.max_per_coin_bps).toBe(4500);
  });

  it("at the slider's bound, moves trades per day instead", () => {
    const low = { corrections: [], current: { version: 3, rules: "r", maxPerCoinBps: 1000, maxTradesPerDay: 4 } };
    const p = fallbackProposal(input(low), "no_llm", null);
    expect(p.config).toMatchObject({ version: 4, max_per_coin_bps: 1000, max_trades_per_day: 3 });
    expect(p.config.changes[0]!.what).toBe("Drawdown reached 12.5 % → trades per day 4 → 3");
  });
});
