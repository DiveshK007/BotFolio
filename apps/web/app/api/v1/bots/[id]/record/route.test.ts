import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { samplePage } from "@/lib/bot-record.fixture";
import { GET } from "./route";

const HEX = (b: string) => `0x${b.repeat(32)}`;
const proofTrust = { botId: "7", leaf: HEX("44"), proof: [HEX("55"), HEX("66")] };

const call = (id: string) => GET(new Request(`https://botfolio.example/api/v1/bots/${id}/record`), { params: Promise.resolve({ id }) });
const worker = (body: unknown, status = 200) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

describe("GET /api/v1/bots/:id/record", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_RELAY_URL", "https://worker.example"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("answers with the MCP get_bot_record payload and nothing more", async () => {
    const page = samplePage();
    const raw = {
      ...page,
      bot: { ...page.bot, privy_did: "did:privy:secret" },
      versions: page.versions.map((v) => ({ ...v, runner_sig: "0xsig" })),
      trust: { ...page.trust!, ...proofTrust },
    };
    const f = worker({ ok: true, page: raw });
    vi.stubGlobal("fetch", f);

    const res = await call("7");
    expect(res.status).toBe(200);
    expect(f.mock.calls[0]![0]).toBe("https://worker.example/bot-page?bot=7");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toContain("s-maxage=60");

    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["bot", "chain", "note", "seasons", "trades", "trust", "versions"]);
    expect(body.bot).toEqual(page.bot);
    expect(body.versions).toEqual(page.versions);
    expect(body.trades).toEqual(page.trades);
    expect(body.trust).toEqual({ ...page.trust, ...proofTrust });
    expect(body.chain).toEqual({ chain_id: 1990, explorer: "https://mainnet.qie.digital" });
    expect(body.note).toContain("Play money. Not investment advice. No prizes.");
    expect(JSON.stringify(body)).not.toMatch(/privy|runner_sig|start_cash|decisions|mark/);
  });

  it("leaves out a trust score that has no valid Merkle proof", async () => {
    vi.stubGlobal("fetch", worker({ ok: true, page: { ...samplePage(), trust: { ...samplePage().trust!, ...proofTrust, proof: ["0x12"] } } }));
    expect((await (await call("7")).json()).trust).toBeNull();
  });

  it("maps each failure to a status without asking the worker for a bad id", async () => {
    const f = worker({});
    vi.stubGlobal("fetch", f);
    const bad = await call("7;drop");
    expect(bad.status).toBe(400);
    expect(bad.headers.get("cache-control")).toBe("no-store");
    expect(f).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", worker({ ok: false }, 404));
    expect((await call("7")).status).toBe(404);
    vi.stubGlobal("fetch", worker({ ok: false }, 500));
    expect((await call("7")).status).toBe(502);
    vi.stubEnv("NEXT_PUBLIC_RELAY_URL", "");
    const off = await call("7");
    expect(off.status).toBe(503);
    expect(await off.json()).toEqual({ error: { code: "NOT_LIVE", message: expect.any(String) } });
  });
});
