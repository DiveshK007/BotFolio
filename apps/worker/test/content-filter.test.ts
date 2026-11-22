import { FakeLlmClient, loadLlmConfig } from "@botfolio/llm";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/canonical";
import { filterOutput, NEUTRAL_ROAST, NEUTRAL_WHY, neutralReason } from "../src/gate/filter-output";
import { gate } from "../src/gate/gate";
import { createPersona, sanitizePersona } from "../src/persona/persona";
import { bannedRules } from "../src/text/content-filter";
import { buy, decision, gateInput } from "./helpers/fixtures";

// Encoded like the list itself, so the test file doesn't spell slurs out either.
const decode = (b64: string) => Buffer.from(b64, "base64").toString("utf8");
const SLUR = decode("cmV0YXJk");
const HINDI_SLUR = decode("Ymhhbmdp");
const DOUBLE_G = decode("bmlnZ2Vy");

describe("bannedRules(): slurs", () => {
  it.each([
    ["plain", SLUR],
    ["plural", `${SLUR}s`],
    ["upper case", SLUR.toUpperCase()],
    ["stretched", SLUR.replace("a", "aaaa")],
    ["leetspeak", SLUR.replace("e", "3").replace("a", "@")],
    ["spaced out", [...SLUR].join(" ")],
    ["dotted", [...SLUR].join(".")],
    ["underscores", [...SLUR].join("_")],
    ["zero-width space", `${SLUR.slice(0, 3)}​${SLUR.slice(3)}`],
    ["accent", SLUR.replace("e", "é")],
    ["Cyrillic lookalike", SLUR.replace("a", "а")],
    ["Hindi", HINDI_SLUR],
    ["double letter", DOUBLE_G],
  ])("catches %s", (_name, text) => {
    expect(bannedRules(`what a ${text} move`)).toEqual(["slur"]);
  });

  it.each([
    "Niger river vibes, flowing into BTC",
    "Scunthorpe United of crypto",
    "Retarget to 20% Gold",
    "A B C of trading: always be compounding",
    "Pakistan cricket energy",
    "Holding SOL, XRP and 4 more hours of patience",
  ])("leaves %j alone", (text) => {
    expect(bannedRules(text)).toEqual([]);
  });
});

describe("bannedRules(): real-money advice", () => {
  it.each([
    "Buy now on the app before it moons",
    "BUY BTC NOW ON any exchange",
    "Get some SOL on Binance",
    "Gold is guaranteed profit",
    "Risk-free returns with XRP",
    "You should buy Bitcoin today",
    "Invest your money in gold",
    "Put all your savings into ETH",
    "Worth your life savings",
    "Go do this with real money",
    "Buy it for real this time",
    "Take out a loan and go long",
    "Paisa lagao gold mein",
  ])("catches %j", (text) => {
    expect(bannedRules(text)).toContain("money_advice");
  });

  it.each([
    "Buy now on the dip, regret later",
    "Bought BTC on the dip because momentum looked strong",
    "Selling half my SOL to take profit",
    "It's not real money, relax",
    "Play money, no real money harmed",
    "Cashing out of ETH into cash",
    "AlphaWolf is sulking in cash after Tuesday's gold mess",
    "Lost ₹12,400 going all-in on gold at 2 AM. Roast him.",
    "Trend up, so I bought ETH.",
  ])("leaves %j alone", (text) => {
    expect(bannedRules(text)).toEqual([]);
  });
});

describe("bannedRules(): URLs", () => {
  it.each(["see https://x.io/abc", "join t.me/pump", "evil​.com has tips"])("catches %j", (text) => {
    expect(bannedRules(text)).toContain("url");
  });
});

describe("gate() SPEC §6.4 step 8: banned content", () => {
  const run = (patch: object, ...actions: Parameters<typeof decision>) =>
    gate(gateInput(), { ...decision(...actions), ...patch }, "gate-test");

  it("replaces a banned reason with neutral text and flags it", () => {
    const r = run({ reason: "Buy BTC now on Binance, trust me" }, buy("BTC", 10));
    expect(r.output?.reason).toBe("Picked BTC this slot. (Original note hidden.)");
    expect(r.textFlags).toEqual([{ field: "reason", rule: "money_advice" }]);
  });

  it("replaces a banned roast", () => {
    const r = run({ roast: `total ${SLUR}` });
    expect(r.output?.roast).toBe(NEUTRAL_ROAST);
    expect(r.textFlags).toEqual([{ field: "roast", rule: "slur" }]);
  });

  it("filterOutput() replaces and flags a banned daily_call why, the public gate result doesn't mention it", () => {
    const view = { btc_up: false, why: "guaranteed profit" };
    const served = filterOutput({ ...decision(), daily_call: view }, []);
    expect(served.output.daily_call).toEqual({ btc_up: false, why: NEUTRAL_WHY });
    expect(served.textFlags).toEqual([{ field: "daily_call.why", rule: "money_advice" }]);
    expect(run({ daily_call: view }).textFlags).toEqual([]);
  });

  // gate_result is public through site_decisions, and the view is secret until the user picks (§6.4.1).
  it.each([true, false])("never puts the Daily Call view (btc_up=%s) in the gate result", (btcUp) => {
    const r = run({ daily_call: { btc_up: btcUp, why: "Momentum" } });
    expect(r.output).not.toHaveProperty("daily_call");
    expect(JSON.stringify(r, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))).not.toMatch(/btc_up|daily_call"/);
  });

  it("leaves clean text as it is", () => {
    const r = run({ roast: "Diamond hands, paper brain." }, buy("ETH", 10));
    expect(r.output).toMatchObject({ reason: decision().reason, roast: "Diamond hands, paper brain." });
    expect(r.textFlags).toEqual([]);
  });

  it("never changes orders and is not a gate event", () => {
    const clean = run({}, buy("BTC", 10));
    const dirty = run({ reason: `what a ${SLUR} market` }, buy("BTC", 10));
    expect(dirty.orders).toEqual(clean.orders);
    expect(dirty.events).toEqual([]);
  });

  it("the public gate_result carries none of the hidden text", () => {
    const r = run({ reason: `what a ${SLUR} market`, roast: "join t.me/pump" }, buy("BTC", 10));
    expect(canonicalJson(r)).not.toMatch(new RegExp(`${SLUR}|t\\.me`));
  });

  it.each([SLUR, "constructor", "__proto__"])("an unknown key is invalid and not echoed (%#)", (key) => {
    const output: unknown = JSON.parse(canonicalJson(decision()).replace("{", `{${JSON.stringify(key)}:"x",`));
    const r = gate(gateInput(), output, "gate-test");
    expect(r.status).toBe("invalid");
    expect(r.errors).toEqual(["an unknown key is not allowed"]);
  });

  it("neutral text passes its own filter and the §6.3 lengths", () => {
    for (const text of [neutralReason([]), neutralReason(["BTC", "ETH", "SOL", "XRP", "GOLD"])]) {
      expect(bannedRules(text)).toEqual([]);
      expect(text.length).toBeGreaterThanOrEqual(10);
      expect(text.length).toBeLessThanOrEqual(140);
    }
    expect([...bannedRules(NEUTRAL_ROAST), ...bannedRules(NEUTRAL_WHY)]).toEqual([]);
  });
});

describe("persona banned-content filter (#41, SPEC §11)", () => {
  const good = { name: "Gold Guru", emoji: "🪙", persona: "Careful.", rules: "Mostly gold." };

  it.each([
    ["name", `${SLUR} bot`, "slur"],
    ["persona", "Promises guaranteed profit.", "money_advice"],
    ["rules", "You should buy gold on Zerodha.", "money_advice"],
  ] as const)("replaces a banned %s and flags it", (field, text, rule) => {
    const r = sanitizePersona({ ...good, [field]: text });
    expect(r.flags).toEqual([{ field, rule }]);
    expect(r.persona[field]).not.toBe(text);
    expect(bannedRules(r.persona[field])).toEqual([]);
  });

  it("is applied by createPersona", async () => {
    const llm = new FakeLlmClient([{ ...good, name: SLUR, max_per_coin_pct: 25, max_trades_per_day: 3 }]);
    const r = await createPersona({ llm, config: loadLlmConfig({}), sentence: "loves gold" });
    expect(r).toMatchObject({ status: "ok", persona: { name: "Rookie Bot" }, flags: [{ field: "name", rule: "slur" }] });
  });
});
