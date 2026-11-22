import { afterEach, describe, expect, it, vi } from "vitest";
import { postRelay, requestPersona } from "./worker";
import type { ForwardRequestJson } from "./relay-types";

const auth = { authKind: "privy" as const, getAuthToken: async () => "test-token" };
const request = {} as ForwardRequestJson; // the body is opaque to this client
const base = "https://worker.example";

const respond = (body: unknown, status = 200) => {
  const mock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", mock);
  return mock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("requestPersona", () => {
  const persona = { name: "Dip", emoji: "🐻", persona: "Waits", rules: "Buys dips", max_per_coin_pct: 30, max_trades_per_day: 3 };
  const personaHash = `0x${"cd".repeat(32)}`;

  it("sends the sentence, the 18+ confirmation and auth", async () => {
    const mock = respond({ ok: true, persona, personaHash });
    await expect(requestPersona(base, auth, "Buys dips")).resolves.toMatchObject({ personaHash, persona: { name: "Dip" } });

    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("https://worker.example/persona");
    expect(JSON.parse(init!.body as string)).toEqual({ sentence: "Buys dips", termsAccepted: true });
    expect(init!.headers).toMatchObject({ authorization: "Bearer test-token", "x-botfolio-auth": "privy" });
  });

  it("fails on an off-schema persona", async () => {
    respond({ ok: true, persona: { ...persona, max_per_coin_pct: 90 }, personaHash });
    await expect(requestPersona(base, auth, "x")).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("fails on today's worker, which has no such route", async () => {
    respond({ error: "not found" }, 404);
    await expect(requestPersona(base, auth, "x")).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("gives up after the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    const result = expect(requestPersona(base, auth, "x")).rejects.toMatchObject({ code: "NO_ANSWER" });
    await vi.advanceTimersByTimeAsync(25_000);
    await result;
  });
});

describe("postRelay", () => {
  it("passes the relayer's error through", async () => {
    respond({ ok: false, error: { code: "RATE_LIMITED_IP", message: "3 new bots a day per connection." } }, 429);
    await expect(postRelay(base, auth, request)).rejects.toMatchObject({
      code: "RATE_LIMITED_IP",
      message: "3 new bots a day per connection.",
    });
  });

  it.each([
    [{ ok: true }, 200],
    [{ ok: true, txHash: "0x1234" }, 200],
    [{ ok: true, txHash: `0x${"ef".repeat(32)}` }, 500],
    ["<html>502</html>", 502],
  ])("never treats %j (HTTP %i) as success", async (body, status) => {
    respond(body, status);
    await expect(postRelay(base, auth, request)).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("doesn't claim nothing was sent when the answer is lost", async () => {
    vi.stubGlobal("fetch", async () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(postRelay(base, auth, request)).rejects.toMatchObject({
      code: "NO_ANSWER",
      message: expect.stringContaining("couldn't confirm"),
    });
  });
});
