import { readFileSync } from "node:fs";
import { FakeLlmClient, loadLlmConfig, validateJson, type BudgetState, type FakeReply } from "@botfolio/llm";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { hashJson } from "../src/canonical";
import { BUDGET_HOLD_MODEL, runDecisionCall, wantsDailyCall } from "../src/decision/call";
import { buildDecisionInput, type DecisionContext } from "../src/decision/input";
import { decisionPrompt } from "../src/decision/prompt";
import { DECISION_OUTPUT_SCHEMA, DECISION_SCHEMA, decisionSchemaFor } from "../src/decision/schema";
import { gate } from "../src/gate/gate";
import { DAILY_CALL_BOT_VIEW_TYPES, dailyCallDomain, istDay } from "../src/interfaces";
import { signDailyCallView } from "../src/signing";
import { E8, buy, decision, gateInput, liveStalePrices, portfolio, prices } from "./helpers/fixtures";

const ist = (time: string) => new Date(`2026-11-23T${time}:00+05:30`);
const ONE_PM = { kind: "scheduled" as const, time: ist("13:00") };
const NINE_AM = { kind: "scheduled" as const, time: ist("09:00") };

const CONTEXT: DecisionContext = {
  slotTime: ONE_PM.time,
  bot: {
    name: "AlphaWolf",
    persona: "Bold.",
    rules: "Momentum.",
    maxPerCoinBps: 2500,
    maxTradesPerDay: 4,
    tradesToday: 1,
    version: 2,
  },
  portfolio: portfolio({ GOLD: 35, BTC: 25 }),
  startValueE8: 1000n * E8,
  avgEntryE8: { GOLD: 370_010_000_000n },
  prices: prices(),
  changes: { BTC: { chg24hPct: -1.24, chg7dPct: 3.44 } },
  recentCorrections: [{ chip: "too risky", note: "stop going all in" }, { chip: "too timid", note: null }],
};
const INPUT = buildDecisionInput(CONTEXT);
const VIEW = { btc_up: true, why: "Dips get bought." };

async function call(
  replies: FakeReply[],
  over: { slot?: { kind: "scheduled" | "debut"; time: Date }; budget?: BudgetState; timeoutMs?: number } = {},
) {
  const llm = new FakeLlmClient(replies);
  const lines: string[] = [];
  const result = await runDecisionCall({
    llm,
    config: { ...loadLlmConfig({ LLM_MODEL_DECISION: "decision-model" }), timeoutMs: over.timeoutMs ?? 1000 },
    input: INPUT,
    slot: over.slot ?? ONE_PM,
    budget: over.budget ?? "ok",
    logLine: (line) => lines.push(line),
  });
  return { llm, result, lines };
}

describe("buildDecisionInput() (SPEC §6.2)", () => {
  it("has the spec's shape", () => {
    expect(INPUT).toEqual({
      slot: "2026-11-23T13:00:00+05:30",
      bot: {
        name: "AlphaWolf",
        persona: "Bold.",
        rules: "Momentum.",
        max_per_coin_pct: 25,
        max_trades_per_day: 4,
        trades_today: 1,
        version: 2,
      },
      portfolio: {
        cash_pct: 40,
        holdings: [
          { asset: "BTC", pct: 25, avg_entry: null },
          { asset: "GOLD", pct: 35, avg_entry: 3700.1 },
        ],
        value_play_usd: 100000,
      },
      market: [
        { asset: "BTC", price: 60000, chg_24h_pct: -1.2, chg_7d_pct: 3.4, fresh: true },
        { asset: "ETH", price: 1700, chg_24h_pct: null, chg_7d_pct: null, fresh: true },
        { asset: "SOL", price: 70, chg_24h_pct: null, chg_7d_pct: null, fresh: true },
        { asset: "XRP", price: 0.93, chg_24h_pct: null, chg_7d_pct: null, fresh: true },
        { asset: "GOLD", price: 3550, chg_24h_pct: null, chg_7d_pct: null, fresh: true },
      ],
      recent_corrections: [{ chip: "too risky", note: "stop going all in" }, { chip: "too timid", note: "" }],
    });
  });

  it("uses the same keys as the example in SPEC.md", () => {
    const spec = readFileSync(new URL("../../../SPEC.md", import.meta.url), "utf8");
    const example = JSON.parse(/### 6\.2[\s\S]*?```json\n([\s\S]*?)```/.exec(spec)![1]!.replace("}, ...]", "}]"));
    const keys = (value: object) => Object.keys(value).sort();
    expect(keys(INPUT)).toEqual(keys(example));
    expect(keys(INPUT.bot)).toEqual(keys(example.bot));
    expect(keys(INPUT.portfolio)).toEqual(keys(example.portfolio));
    expect(keys(INPUT.portfolio.holdings[0]!)).toEqual(keys(example.portfolio.holdings[0]));
    expect(keys(INPUT.market[0]!)).toEqual(keys(example.market[0]));
    expect(keys(INPUT.recent_corrections[0]!)).toEqual(keys(example.recent_corrections[0]));
  });

  it("marks only BTC and ETH fresh in the live stale case", () => {
    const input = buildDecisionInput({ ...CONTEXT, prices: liveStalePrices() });
    expect(input.market.filter((m) => m.fresh).map((m) => m.asset)).toEqual(["BTC", "ETH"]);
    expect(input.portfolio.holdings.map((h) => h.pct)).toEqual([25, 35]);
  });
});

describe("decision schema (SPEC §6.3, §6.4.1)", () => {
  it("a normal slot sends §6.3 as it is", () => {
    expect(decisionSchemaFor(false)).toBe(DECISION_SCHEMA);
  });

  it("09:00 and debut requests require daily_call", () => {
    expect(validateJson(decisionSchemaFor(true), decision())).not.toEqual([]);
    expect(validateJson(decisionSchemaFor(true), { ...decision(), daily_call: VIEW })).toEqual([]);
  });

  it("logged output may have it or not", () => {
    expect(validateJson(DECISION_OUTPUT_SCHEMA, decision())).toEqual([]);
    expect(validateJson(DECISION_OUTPUT_SCHEMA, { ...decision(), daily_call: VIEW })).toEqual([]);
  });

  it("limits why to 80 chars", () => {
    const long = { ...decision(), daily_call: { btc_up: true, why: "x".repeat(81) } };
    expect(validateJson(decisionSchemaFor(true), long)).not.toEqual([]);
  });
});

describe("wantsDailyCall()", () => {
  it.each([
    ["scheduled", "09:00", true],
    ["scheduled", "13:00", false],
    ["scheduled", "17:00", false],
    ["scheduled", "21:00", false],
    ["debut", "15:37", true],
    ["debut", "00:05", true],
    ["debut", "19:59", true],
    // #219: from 20:00 the day's calls are closed, so no signed view for it.
    ["debut", "20:00", false],
    ["debut", "23:30", false],
  ] as const)("%s at %s IST → %s", (kind, time, wanted) => {
    expect(wantsDailyCall({ kind, time: ist(time) })).toBe(wanted);
  });
});

describe("runDecisionCall()", () => {
  it("sends prompt-v1, the §6.2 input and the strict schema", async () => {
    const { llm } = await call([decision(buy("BTC", 10))]);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]).toMatchObject({
      system: decisionPrompt("prompt-v1").system,
      input: INPUT,
      schema: DECISION_SCHEMA,
      schemaName: "decision_v1",
      model: "decision-model",
      temperature: 0,
    });
  });

  it("logs prompt version, model, temperature and both hashes", async () => {
    const output = decision(buy("BTC", 10));
    const { result, lines } = await call([output]);
    const expected = {
      promptVersion: "prompt-v1",
      promptHash: decisionPrompt("prompt-v1").hash,
      model: "decision-model",
      temperature: 0,
      attempts: 1,
      inputHash: hashJson(INPUT),
      outputHash: hashJson(output),
    };
    expect(result.log).toMatchObject({ ...expected, inputJson: INPUT, rawOutputJson: output });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "llm.decision", status: "ok", ...expected });
    expect(lines[0]).not.toContain("Momentum."); // bot text stays out of the server log
  });

  it.each([
    ["09:00 slot", NINE_AM],
    ["debut", { kind: "debut" as const, time: ist("15:37") }],
  ])("returns daily_call at the %s", async (_name, slot) => {
    const { llm, result } = await call([{ ...decision(), daily_call: VIEW }], { slot });
    expect(llm.calls[0]!.schema).toEqual(decisionSchemaFor(true));
    expect(result.output?.daily_call).toEqual(VIEW);
  });

  it("the debut only offers assets with a fresh price, so the first trade isn't lost to a stale feed (#219 item 18)", async () => {
    const input = buildDecisionInput({ ...CONTEXT, prices: liveStalePrices() }); // only BTC and ETH fresh
    const debut = { kind: "debut" as const, time: ist("15:37") };
    const run = (reply: FakeReply, slot: { kind: "scheduled" | "debut"; time: Date } = debut) => {
      const llm = new FakeLlmClient([reply]);
      const config = { ...loadLlmConfig({}), timeoutMs: 1000 };
      return { llm, done: runDecisionCall({ llm, config, input, slot, budget: "ok", logLine: () => {} }) };
    };

    const btc = run({ ...decision(buy("BTC", 10)), daily_call: VIEW });
    expect((await btc.done).status).toBe("ok");
    const sent = btc.llm.calls[0]!.schema as typeof DECISION_SCHEMA;
    expect(sent.properties.actions.items.properties.asset).toEqual({ enum: ["BTC", "ETH"] });

    expect((await run({ ...decision(buy("GOLD", 10)), daily_call: VIEW }).done).status).toBe("invalid");
    // Scheduled slots keep every asset: a stale one there is retried at +5/+10/+15 min.
    expect((await run(decision(buy("GOLD", 10)), ONE_PM).done).status).toBe("ok");
  });

  it("treats a missing daily_call at 09:00 as invalid output", async () => {
    expect((await call([decision()], { slot: NINE_AM })).result.status).toBe("invalid");
  });

  it("SPEC §6.4 step 1: one retry, then the good output goes through", async () => {
    const { llm, result } = await call(["not json", decision(buy("BTC", 10))]);
    expect(llm.calls).toHaveLength(2);
    expect(result).toMatchObject({ status: "ok", log: { attempts: 2 } });
  });

  it("SPEC §6.4 step 1: still invalid after one retry → invalid, hold", async () => {
    const bad = { ...decision(), reason: "yolo" };
    const { llm, result } = await call([bad]);
    expect(llm.calls).toHaveLength(2);
    if (result.status !== "invalid") throw new Error("expected invalid");
    expect(result.reason.length).toBeGreaterThanOrEqual(10);
    expect(result.log).toMatchObject({ rawOutputJson: bad, outputHash: hashJson(bad) });
    expect(gate(gateInput(), result.log.rawOutputJson, "gate-test")).toMatchObject({ status: "invalid", orders: [] });
  });

  it("keeps text that isn't canonical JSON", async () => {
    for (const raw of ["not json", '{"pct":1e999}']) {
      expect((await call([raw])).result.log).toMatchObject({ rawOutputJson: raw, outputHash: hashJson(raw) });
    }
  });

  it("times out, retries once, then holds", async () => {
    const { llm, result } = await call([{ hang: true }], { timeoutMs: 20 });
    expect(llm.calls).toHaveLength(2);
    expect(result).toMatchObject({ status: "invalid", log: { rawOutputJson: null, error: expect.stringContaining("timeout") } });
  });

  it("budget used up → deterministic hold without calling the LLM", async () => {
    const { llm, result } = await call([decision()], { budget: "resting", slot: NINE_AM });
    expect(llm.calls).toEqual([]);
    expect(result).toMatchObject({ status: "ok", source: "budget_hold", log: { model: BUDGET_HOLD_MODEL } });
    expect(gate(gateInput(), result.output, "gate-test")).toMatchObject({ status: "held", orders: [] });
  });

  it.each(["alert", "uncapped"] as const)("budget %s still calls the LLM", async (budget) => {
    expect((await call([decision()], { budget })).llm.calls).toHaveLength(1);
  });
});

describe("decisionPrompt()", () => {
  it("refuses an unknown PROMPT_VERSION", () => {
    expect(() => decisionPrompt("prompt-v9")).toThrow(/PROMPT_VERSION/);
    expect(() => decisionPrompt("toString")).toThrow(/PROMPT_VERSION/);
  });

  it("prompt-v1 never changes", () => {
    expect(decisionPrompt("prompt-v1").hash).toMatchInlineSnapshot(`"0x0e339b745483aa4ad992e65adeb67137652af9a20c08a7b5e3bb2e09c4f06077"`);
  });
});

describe("signDailyCallView() (SPEC §4.7)", () => {
  it("uses the EIP-712 type in IDailyCall", () => {
    const sol = readFileSync(new URL("../../../packages/contracts/src/interfaces/IDailyCall.sol", import.meta.url), "utf8");
    const fields = DAILY_CALL_BOT_VIEW_TYPES.BotView.map((f) => `${f.type} ${f.name}`).join(",");
    expect(sol).toContain(`\`BotView(${fields})\``);
  });

  it("signs botId, the decision's IST day and btc_up", async () => {
    const runner = privateKeyToAccount(generatePrivateKey()); // throwaway, made in memory
    const contract = "0x00000000000000000000000000000000000000d1";
    const decidedAt = ist("00:30"); // still the previous day in UTC
    const signed = await signDailyCallView(runner, contract, { botId: 7n, decidedAt, btcUp: true });
    expect(signed).toMatchObject({ botId: "7", botUp: true, day: istDay(ist("21:00").getTime() / 1000) });

    const recover = (botUp: boolean) =>
      recoverTypedDataAddress({
        domain: dailyCallDomain(contract),
        types: DAILY_CALL_BOT_VIEW_TYPES,
        primaryType: "BotView",
        message: { botId: 7n, day: signed.day, botUp },
        signature: signed.botSig,
      });
    expect(await recover(true)).toBe(runner.address);
    expect(await recover(false)).not.toBe(runner.address);
  });
});
