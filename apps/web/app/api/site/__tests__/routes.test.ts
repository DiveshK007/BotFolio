import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const complete = vi.fn();
vi.mock("@botfolio/llm", () => ({
  createLlmClient: () => ({ provider: "fake", complete }),
  loadLlmConfig: () => ({ models: { persona: "m" }, timeoutMs: 20000 }),
}));
vi.mock("@/lib/bot-record", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bot-record")>("@/lib/bot-record");
  const { samplePage } = await import("@/lib/bot-record.fixture");
  return { ...actual, fetchBotPage: vi.fn(async (id: string) => (id === "7" ? { kind: "ok", page: samplePage() } : { kind: "not_found" })) };
});

const loadStatus = vi.fn();
vi.mock("@/lib/status", () => ({ loadStatus: () => loadStatus() }));

const talkReq = (ip: string, botId = "7") => new Request("http://x/api/site/talk", { method: "POST", headers: { "x-forwarded-for": ip, "content-type": "application/json" }, body: JSON.stringify({ botId, messages: [{ role: "user", content: "zebra-banana-42" }] }) });

describe("POST /api/site/talk", () => {
  beforeEach(() => {
    complete.mockReset();
    vi.stubEnv("TALK_ENABLED", "true");
    loadStatus.mockResolvedValue({ staleFeeds: [], resting: false });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("is off unless TALK_ENABLED=true, before any fetch or LLM call", async () => {
    vi.stubEnv("TALK_ENABLED", "");
    const { fetchBotPage } = await import("@/lib/bot-record");
    vi.mocked(fetchBotPage).mockClear();
    const { POST } = await import("../talk/route");
    const r = await POST(talkReq("6.6.6.6"));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "talk_disabled" });
    expect(fetchBotPage).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
  it.each([["resting", { staleFeeds: [], resting: true }], ["unreadable", null]])("rests when the worker's status is %s", async (_name, status) => {
    loadStatus.mockResolvedValue(status);
    const { POST } = await import("../talk/route");
    const r = await POST(talkReq("7.7.7.7"));
    expect(r.status).toBe(503);
    expect(complete).not.toHaveBeenCalled();
  });
  it("stops at the daily call cap across visitors", async () => {
    vi.resetModules(); // a fresh cap for this test only
    complete.mockResolvedValue({ output: { reply: "ok" } });
    const { POST } = await import("../talk/route");
    for (let i = 0; i < 300; i++) expect((await POST(talkReq(`10.0.${i >> 8}.${i & 255}`))).status).toBe(200);
    const r = await POST(talkReq("10.9.9.9"));
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: "busy" });
    vi.resetModules();
  });
  it("answers in character from the record", async () => {
    complete.mockResolvedValue({ output: { reply: "Bought a little BTC. Calmly." } });
    const { POST } = await import("../talk/route");
    const r = await POST(talkReq("1.1.1.1"));
    expect(await r.json()).toEqual({ reply: "Bought a little BTC. Calmly." });
    const sent = complete.mock.calls[0]![0];
    expect(sent.input.facts.name).toBe("AlphaWolf");
    expect(sent.system).not.toContain("zebra-banana-42");
    expect(JSON.stringify(sent.input)).toContain("zebra-banana-42"); // user text never goes in the system prompt
  });
  it("replaces replies that use banned money words", async () => {
    complete.mockResolvedValue({ output: { reply: "You could earn a lot of profit!" } });
    const { POST } = await import("../talk/route");
    const j = await (await POST(talkReq("2.2.2.2"))).json();
    expect(j.reply).not.toMatch(/earn|profit/i);
  });
  it("rate-limits after 6 messages per visitor", async () => {
    complete.mockResolvedValue({ output: { reply: "ok" } });
    const { POST } = await import("../talk/route");
    for (let i = 0; i < 6; i++) await POST(talkReq("3.3.3.3"));
    expect((await POST(talkReq("3.3.3.3"))).status).toBe(429);
  });
  it("404s an unknown bot and 503s when the LLM fails", async () => {
    const { POST } = await import("../talk/route");
    expect((await POST(talkReq("4.4.4.4", "999"))).status).toBe(404);
    complete.mockResolvedValue({ output: {} }); // malformed provider answer → treated as unavailable
    expect((await POST(talkReq("5.5.5.5"))).status).toBe(503);
  });
});

describe("GET /api/site/verify", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("rejects a bad hash", async () => {
    const { GET } = await import("../verify/route");
    expect((await GET(new Request("http://x/api/site/verify?tx=nope"))).status).toBe(400);
  });
  it("reads the tx and receipt from QIE", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const { method } = JSON.parse(String(init.body));
      const result = method === "eth_getTransactionByHash" ? { to: "0x" + "9".repeat(40), blockNumber: "0x10" } : { status: "0x1", logs: [{}, {}], blockNumber: "0x10" };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    }));
    const { GET } = await import("../verify/route");
    const j = await (await GET(new Request(`http://x/api/site/verify?tx=0x${"ab".repeat(32)}`))).json();
    expect(j).toMatchObject({ ok: true, found: true, block: "16", status: "success", logs: 2, contract: null });
  });
  it("says so when every RPC fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("tls"); }));
    const { GET } = await import("../verify/route");
    expect((await GET(new Request(`http://x/api/site/verify?tx=0x${"ab".repeat(32)}`))).status).toBe(502);
  });
});

describe("POST /api/site/event", () => {
  it("logs allowed events only, with filtered props", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const { POST } = await import("../event/route");
    await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ name: "dc_pick", props: { pick: "up", sentence: "x".repeat(200), Bad: 1 } }) }));
    await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ name: "steal_wallet", props: {} }) }));
    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(log.mock.calls[0]![0]));
    expect(line.props).toEqual({ pick: "up" });
    log.mockRestore();
  });
});

describe("GET /api/site/cards", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const get = async (bot: string) => (await import("../cards/route")).GET(new Request(`http://x/api/site/cards?bot=${bot}`));
  it("turns away a bad bot id before any read", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await get("0")).status).toBe(400);
    expect((await get("7%26limit%3D999")).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("lists the newest 5 readable cards of the bot, and 502s on a failed read", async () => {
    const { MOCK_CARDS } = await import("../../card/fixtures");
    vi.stubEnv("SUPABASE_URL", "https://db.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    const fetch = vi.fn(async () => Response.json([
      { id: "trade-7", payload: MOCK_CARDS.trade, created_at: "2026-11-27T04:00:00Z" },
      { id: "junk", payload: { kind: "trade" }, created_at: "2026-11-27T03:00:00Z" },
    ]));
    vi.stubGlobal("fetch", fetch);
    const j = await (await get("7")).json();
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe("https://db.example/rest/v1/site_cards?bot_id=eq.7&select=id,payload,created_at&order=created_at.desc&limit=5");
    expect(j.cards).toHaveLength(1);
    expect(j.cards[0]).toMatchObject({ id: "trade-7", createdAt: "2026-11-27T04:00:00Z", headline: expect.any(String) });
    fetch.mockResolvedValueOnce(new Response("", { status: 500 }));
    expect((await get("7")).status).toBe(502);
  });
});
