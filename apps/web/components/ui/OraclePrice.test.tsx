import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AssetId } from "@botfolio/shared";
import { OraclePrice } from "./OraclePrice";

// #151: the price-age label as the bot page renders it, not only priceAge() on its own (SPEC §5.7).
const NOW = 1_800_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => vi.useRealTimers());

const render = (asset: AssetId, ageSeconds: number) =>
  renderToStaticMarkup(
    createElement(OraclePrice, { asset, answerE8: 265_000_000_000n, roundId: "1234", updatedAt: NOW - ageSeconds }),
  );

it.each([
  ["BTC 1 min", "BTC", 60, "muted", "1m old"],
  ["Gold 3 h", "GOLD", 3 * 3600 + 120, "amber", "Gold price 3h old"],
  ["Gold at its 6 h limit", "GOLD", 21_600, "amber", "Gold price 6h old"],
  ["Gold past 6 h", "GOLD", 21_601, "grey", "Holding — price too old"],
  ["ETH past 30 min", "ETH", 1801, "grey", "Holding — price too old"],
] as const)("%s → %s '%s'", (_name, asset, age, tone, text) => {
  expect(render(asset, age)).toContain(`data-tone="${tone}">${text}</span>`);
});

it("names the quote and the round next to the price", () => {
  const html = render("GOLD", 60);
  expect(html).toContain("$2,650.00");
  expect(html).toContain("USD, QIE oracle round 1234");
});
