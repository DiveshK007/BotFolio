import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PersonaCard } from "./PersonaCard";

it("escapes markup in every untrusted field (#159)", () => {
  const html = renderToStaticMarkup(
    createElement(PersonaCard, {
      persona: {
        name: "<script>a()</script>",
        emoji: "<b>",
        persona: '<img src=x onerror="b()">',
        rules: '<a href="javascript:c()">tap</a>',
        limits: { maxPerCoinPct: 20, maxTradesPerDay: 2 },
      },
    }),
  );
  for (const tag of ["<script", "<b>", "<img", "<a "]) expect(html).not.toContain(tag);
  expect(html).toContain("&lt;script&gt;");
});

it("renders the carried DNA bot when dnaSeed is provided", () => {
  const html = renderToStaticMarkup(
    createElement(PersonaCard, {
      persona: { name: "AlphaWolf", emoji: "🐺", persona: "Buys dips.", rules: "Calm.", limits: { maxPerCoinPct: 20, maxTradesPerDay: 2 } },
      dnaSeed: "pet-42-wolf",
    }),
  );
  expect(html).toContain("<svg");
});
