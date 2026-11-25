import { describe, expect, it, vi } from "vitest";
import { fetchStatus, statusMessages } from "./status";

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("fetchStatus", () => {
  it("returns the worker's status, dropping unknown feed ids", async () => {
    const f = reply(200, { ok: true, staleFeeds: ["GOLD", "<b>x</b>"], resting: false });
    expect(await fetchStatus("https://w.test", f)).toEqual({ staleFeeds: ["GOLD"], resting: false });
    expect(f).toHaveBeenCalledWith("https://w.test/status", { credentials: "omit" });
  });

  it.each([
    [429, { ok: false }],
    [200, { ok: true }],
    [200, { ok: true, staleFeeds: "GOLD", resting: false }],
    [200, { ok: true, staleFeeds: [], resting: "yes" }],
  ])("returns null for %i %j", async (status, body) => {
    expect(await fetchStatus("https://w.test", reply(status, body))).toBeNull();
  });

  it("returns null when the worker can't be reached", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await fetchStatus("https://w.test", f)).toBeNull();
  });
});

describe("statusMessages", () => {
  it("says nothing when all is well or the status is unknown", () => {
    expect(statusMessages(null)).toEqual([]);
    expect(statusMessages({ staleFeeds: [], resting: false })).toEqual([]);
  });

  it("names one delayed feed", () => {
    expect(statusMessages({ staleFeeds: ["GOLD"], resting: false })).toEqual([
      "Gold prices are delayed — bots hold gold until the oracle updates.",
    ]);
  });

  it("lists several delayed feeds and the resting bots", () => {
    expect(statusMessages({ staleFeeds: ["BTC", "SOL", "GOLD"], resting: true })).toEqual([
      "Bitcoin, Solana and Gold prices are delayed — bots hold them until the oracle updates.",
      "Bots are resting — they'll hold until the AI is back.",
    ]);
  });
});
