import { describe, expect, it, vi } from "vitest";
import {
  parseUsdInr,
  USD_INR_FALLBACK,
  USD_INR_REFRESH_MS,
  USD_INR_RETRY_MS,
  usdInrCache,
} from "../../src/fx/usd-inr";

const live = (rate: number) => ({ amount: 1, base: "USD", date: "2026-11-24", rates: { INR: rate } });

function setup(load: (url: string) => Promise<unknown>) {
  let t = 1_800_000_000_000;
  const fetchJson = vi.fn(load);
  const cache = usdInrCache({ url: "https://fx.test/usd-inr", fetchJson, now: () => t });
  return { cache, fetchJson, advance: (ms: number) => (t += ms) };
}

describe("parseUsdInr", () => {
  it("reads rates.INR", () => expect(parseUsdInr(live(92.92))).toBe(92.92));
  it.each([null, {}, { rates: {} }, { rates: { INR: "92" } }, { rates: { INR: 0 } }, { rates: { INR: 9292 } }, { rates: { INR: NaN } }])(
    "rejects %j",
    (json) => expect(parseUsdInr(json)).toBeNull(),
  );
});

describe("usdInrCache", () => {
  it("answers with the fallback until the first fetch lands, then the live rate", async () => {
    const { cache, fetchJson } = setup(async () => live(92.92));
    expect(cache.get()).toEqual({ rate: USD_INR_FALLBACK, fetchedAt: null, source: "fallback" });
    await cache.settled();
    expect(cache.get()).toMatchObject({ rate: 92.92, source: "live" });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson).toHaveBeenCalledWith("https://fx.test/usd-inr");
  });

  it("fetches once a day, not on every read", async () => {
    let rate = 92.92;
    const { cache, fetchJson, advance } = setup(async () => live(rate));
    cache.get();
    await cache.settled();
    rate = 93.1;
    advance(USD_INR_REFRESH_MS - 1);
    expect(cache.get().rate).toBe(92.92);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    advance(1);
    cache.get();
    await cache.settled();
    expect(cache.get().rate).toBe(93.1);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("shares one fetch between concurrent reads", async () => {
    const { cache, fetchJson } = setup(async () => live(92.92));
    cache.get();
    cache.get();
    await cache.settled();
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("keeps the last live rate when a later fetch fails, and retries within the hour", async () => {
    let fail = false;
    const { cache, fetchJson, advance } = setup(async () => {
      if (fail) throw new Error("HTTP 503");
      return live(92.92);
    });
    cache.get();
    await cache.settled();
    fail = true;
    advance(USD_INR_REFRESH_MS);
    cache.get();
    await cache.settled();
    expect(cache.get()).toMatchObject({ rate: 92.92, source: "live" });
    advance(USD_INR_RETRY_MS - 1);
    cache.get();
    expect(fetchJson).toHaveBeenCalledTimes(2);
    advance(1);
    cache.get();
    await cache.settled();
    expect(fetchJson).toHaveBeenCalledTimes(3);
  });

  it("stays on the fallback when the source sends garbage", async () => {
    const { cache } = setup(async () => ({ rates: { INR: "lots" } }));
    cache.get();
    await cache.settled();
    expect(cache.get()).toEqual({ rate: USD_INR_FALLBACK, fetchedAt: null, source: "fallback" });
  });
});
