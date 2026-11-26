import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { samplePage } from "@/lib/bot-record.fixture";
import { BotPageView } from "./BotPageView";

const render = (page = samplePage()) => renderToStaticMarkup(createElement(BotPageView, { page }));

it("shows value in $, holdings with oracle round and age, trust factors, calls, trades with explorer links and versions", () => {
  const html = render();
  expect(html).toContain("$101,000"); // 100000 × 1010 / 1000
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
  expect(html).toContain("the first mark comes with its first trade on QIE");
});

it("an accepted call with no trade on QIE never reads Traded; a stale hold says which price and how old (#370)", () => {
  const page = { ...samplePage(), trades: [], mark: null };
  const d = page.decisions[0]!;
  page.decisions = [
    { ...d, id: "d3", slot_time: "2026-11-26T11:30:00.000Z", status: "skipped_stale", reason: null, reason_tag: "stay_cash", stale: [{ asset: "BTC", age_s: 52 * 60 }], traded: false },
    { ...d, id: "d2", slot_time: "2026-11-26T07:30:00.000Z", traded: false },
  ];
  let html = render(page);
  expect(html).not.toContain("Traded");
  expect(html).toContain("QIE&#x27;s Bitcoin price was 52 min old, so it held.");
  expect(html).toContain("Held · price too old. No reason was logged for this call.");
  expect(html).toContain("Staying in cash");
  expect(html).not.toContain("stay_cash");
  expect(html).toContain("Didn&#x27;t reach QIE, tries again next call");

  page.decisions = [page.decisions[1]!];
  html = render(page);
  expect(html).toContain("Sending to QIE");
});
