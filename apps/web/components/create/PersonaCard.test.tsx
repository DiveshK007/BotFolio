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
