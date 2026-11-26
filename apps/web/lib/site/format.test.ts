import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssetId } from "@botfolio/shared";
import { cryptoDelayed, MAX_AGE_MIN, tickerAge } from "./format";
import { Ticker, type TickerItem } from "@/components/site/arcade";

const NOW = 1_800_000_000;
const ago = (min: number) => NOW - min * 60;
const feeds = (cryptoMin: number, goldMin: number): { asset: AssetId; updatedAt: number }[] =>
  [...(["BTC", "ETH", "SOL", "XRP"] as const).map(asset => ({ asset, updatedAt: ago(cryptoMin) })), { asset: "GOLD", updatedAt: ago(goldMin) }];

describe("MAX_AGE_MIN", () => {
  it("comes from ASSETS.maxAgeSeconds: 30 min crypto, 6 h gold", () => {
    expect(MAX_AGE_MIN).toEqual({ BTC: 30, ETH: 30, SOL: 30, XRP: 30, GOLD: 360 });
  });
});

describe("tickerAge", () => {
  it("is fresh and in minutes under the max age", () => expect(tickerAge("BTC", ago(12), NOW)).toEqual({ tone: "", text: "12m" }));
  it("is grey once past the crypto max age", () => expect(tickerAge("ETH", ago(31), NOW)).toEqual({ tone: "grey", text: "31m" }));
  it("is amber and in hours for gold over 1 h but under 6 h", () => expect(tickerAge("GOLD", ago(185), NOW)).toEqual({ tone: "amber", text: "3h" }));
  it("is grey for gold past 6 h", () => expect(tickerAge("GOLD", ago(361), NOW).tone).toBe("grey"));
  it("never shows a negative age when the browser clock is behind", () => expect(tickerAge("BTC", NOW + 120, NOW).text).toBe("0m"));
});

describe("cryptoDelayed", () => {
  it("is true when every crypto feed is past 30 min, whatever gold does", () => expect(cryptoDelayed(feeds(45, 5), NOW)).toBe(true));
  it("is false when one crypto feed is still fresh", () => {
    const f = feeds(45, 5); f[2].updatedAt = ago(10);
    expect(cryptoDelayed(f, NOW)).toBe(false);
  });
  it("is false at exactly the max age (stale means past it)", () => expect(cryptoDelayed(feeds(30, 5), NOW)).toBe(false));
  it("ignores a stale gold feed", () => expect(cryptoDelayed(feeds(5, 400), NOW)).toBe(false));
  it("is false with no crypto feeds", () => expect(cryptoDelayed([{ asset: "GOLD", updatedAt: ago(999) }], NOW)).toBe(false));
});

describe("Ticker server HTML", () => {
  const items: TickerItem[] = [{ asset: "BTC", price: "$63,922.95", roundId: "50887", updatedAt: ago(90) }];
  it("bakes in prices and rounds but no age or LIVE/DELAYED claim", () => {
    const html = renderToStaticMarkup(createElement(Ticker, { items, status: "live" }));
    expect(html).toContain("$63,922.95");
    expect(html).toContain("round 50887");
    expect(html).not.toMatch(/\d+[mh] old/);
    expect(html).not.toContain("LIVE");
    expect(html).not.toContain("DELAYED");
  });
  it("still says when the oracle can't be read", () => {
    expect(renderToStaticMarkup(createElement(Ticker, { items: null, status: "error" }))).toContain("Oracle prices unavailable");
  });
});
