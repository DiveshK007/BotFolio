import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Arena, type Racer } from "./arcade";

const racer = (id: number, ret: number, isHouse = false): Racer => ({ id, name: `Bot ${id}`, ret, vol: 1, isHouse, lines: ["up", "down"] });

// #147: screen readers ignore aria-label on a plain span (axe aria-prohibited-attr), so the crown is an image.
it("gives the top human bot's crown an image role so its label is read", () => {
  const html = renderToStaticMarkup(
    createElement(Arena, { initial: [racer(1, 9, true), racer(2, 3), racer(3, 1)], btcSeries: [], btcRound: "1", status: "live" }),
  );
  expect(html).toContain('<span class="crown" role="img" aria-label="Top human-raised bot">');
  expect(html.match(/class="crown"/g)).toHaveLength(1); // only the best human bot, never the house bot
});
