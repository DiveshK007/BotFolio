import { describe, expect, it, vi } from "vitest";
import { fetchUsdInr } from "./usd-inr";

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("fetchUsdInr", () => {
  it("returns the worker's rate", async () => {
    const f = reply(200, { ok: true, usdInr: 92.92, fetchedAt: null, source: "live" });
    expect(await fetchUsdInr("https://w.test", f)).toBe(92.92);
    expect(f).toHaveBeenCalledWith("https://w.test/fx/usd-inr", { credentials: "omit" });
  });

  it.each([
    [500, { ok: false }],
    [200, { ok: true }],
    [200, { ok: true, usdInr: "92" }],
    [200, { ok: true, usdInr: 0 }],
  ])("returns null for %i %j", async (status, body) => {
    expect(await fetchUsdInr("https://w.test", reply(status, body))).toBeNull();
  });

  it("returns null when the worker can't be reached", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await fetchUsdInr("https://w.test", f)).toBeNull();
  });
});
