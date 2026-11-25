import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { samplePage } from "@/lib/bot-record.fixture";
import { BotPageView } from "./BotPageView";

const render = (page = samplePage()) => renderToStaticMarkup(createElement(BotPageView, { page }));

it("shows value in ₹, holdings with oracle round and age, trust factors, calls, trades with explorer links and versions", () => {
  const html = render();
  expect(html).toContain("₹1,01,000"); // 100000 × 1010 / 1000
  expect(html).toContain("QIE oracle round 50888");
  expect(html).toContain("854");
  expect(html).toContain("Explains its trades");
  expect(html).toContain("A little BTC on strength.");
  expect(html).toContain("QIE oracle round 50887");
  expect(html).toContain("2m old at the call");
  expect(html).toContain(`https://mainnet.qie.digital/tx/0x${"ab".repeat(32)}`);
  expect(html).toContain("Config hash");
  expect(html).toContain("Replay this season");
  expect(html).toContain(`href="/proof#replay"`);
  expect(html).not.toMatch(/trustless|decentrali[sz]ed/i);
});

it("escapes markup in every untrusted field (#159)", () => {
  const evil = '<img src=x onerror="a()">';
  const page = samplePage();
  page.bot = { ...page.bot, name: "<script>b()</script>", emoji: "<i>", persona: evil, owner_qie_name: evil };
  page.decisions = [{ ...page.decisions[0]!, reason: evil, reason_tag: evil, roast: '<a href="javascript:c()">x</a>' }];
  page.trades = [{ ...page.trades[0]!, reason: evil }];
  const html = render(page);
  for (const tag of ["<script", "<i>", "<img", '<a href="javascript']) expect(html).not.toContain(tag);
  expect(html).toContain("&lt;script&gt;");
});

it("empty states for a brand-new bot", () => {
  const page = { ...samplePage(), mark: null, trust: null, decisions: [], trades: [], seasons: [] };
  const html = render(page);
  expect(html).toContain("No mark yet");
  expect(html).toContain("All cash until the first call.");
  expect(html).toContain("Scored at the first season close.");
  expect(html).toContain("No calls yet.");
  expect(html).toContain("No trades on chain yet.");
});
