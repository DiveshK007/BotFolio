import { describe, expect, it, vi } from "vitest";
import { ageAtCall, bpsPct, callLabel, fetchBotPage, formatUnits, istTime, parseBotPage, weightPct } from "./bot-record";
import { samplePage } from "./bot-record.fixture";

describe("parseBotPage", () => {
  it("accepts the worker's answer and drops malformed rows", () => {
    const page = samplePage();
    const bad = { ...page, trades: [...page.trades, { ...page.trades[0], price_e8: "1.5" }, { ...page.trades[0], asset: "DOGE" }] };
    expect(parseBotPage({ ok: true, page: bad })).toEqual(page);
  });

  it("rejects a broken top level", () => {
    const page = samplePage();
    expect(parseBotPage(null)).toBeNull();
    expect(parseBotPage({ ok: false, page })).toBeNull();
    expect(parseBotPage({ ok: true, page: { ...page, start_cash_e8: "0" } })).toBeNull();
    expect(parseBotPage({ ok: true, page: { ...page, bot: { ...page.bot, id: "7; drop" } } })).toBeNull();
    expect(parseBotPage({ ok: true, page: { ...page, trades: null } })).toBeNull();
  });
});

describe("fetchBotPage", () => {
  const base = "https://worker.example";
  const reply = (body: unknown, status = 200) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

  it("asks the worker for that bot", async () => {
    const f = reply({ ok: true, page: samplePage() });
    await expect(fetchBotPage("7", base, f)).resolves.toMatchObject({ kind: "ok", page: { bot: { id: "7" } } });
    expect(f.mock.calls[0]![0]).toBe("https://worker.example/bot-page?bot=7");
  });

  it("maps each failure to a state", async () => {
    expect(await fetchBotPage("7", null, reply({}))).toEqual({ kind: "not_live" });
    expect(await fetchBotPage("abc", base, reply({}))).toEqual({ kind: "not_found" });
    expect(await fetchBotPage("7", base, reply({ ok: false }, 404))).toEqual({ kind: "not_found" });
    expect(await fetchBotPage("7", base, reply({ ok: false }, 503))).toEqual({ kind: "not_live" });
    expect(await fetchBotPage("7", base, reply({ ok: false }, 500))).toEqual({ kind: "error" });
    expect(await fetchBotPage("7", base, reply({ ok: true, page: {} }))).toEqual({ kind: "error" });
    expect(await fetchBotPage("7", base, vi.fn<typeof fetch>(async () => Promise.reject(new Error("down"))))).toEqual({ kind: "error" });
  });
});

describe("display helpers", () => {
  it("labels calls", () => {
    expect(callLabel("executed")).toBe("Traded");
    expect(callLabel("skipped_stale")).toBe("Held · price too old");
    expect(callLabel("whatever")).toBe("Held");
  });

  it("formats IST, percentages, units and weights", () => {
    expect(istTime("2026-11-26T03:30:00.000Z")).toMatch(/26 Nov.*09:00 IST/);
    expect(istTime("nope")).toBe("—");
    expect(bpsPct(1000)).toBe("+10.00%");
    expect(bpsPct(-250)).toBe("−2.50%");
    expect(bpsPct(2500, false)).toBe("25.00%");
    expect(formatUnits("1500000000000000000")).toBe("1.5");
    expect(formatUnits("1500000000000000")).toBe("0.0015");
    expect(formatUnits("1")).toBe("<0.000001");
    expect(formatUnits("0")).toBe("0");
    expect(weightPct("11000000000", "101000000000")).toBe(11);
    expect(weightPct("1", "0")).toBe(0);
  });

  it("ages a trade's price at its call, not now", () => {
    const t = samplePage().trades[0]!;
    expect(ageAtCall(t)).toBe("2m old at the call");
    expect(ageAtCall({ ...t, oracle_updated_at: null })).toBeNull();
  });
});
