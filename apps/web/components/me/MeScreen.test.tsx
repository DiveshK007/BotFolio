import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { samplePage } from "@/lib/bot-record.fixture";
import type { OwnerConfig } from "@/lib/config";
import type { OwnerBot, PendingBigMove } from "@/lib/owner";
import type { WalletSession } from "@/lib/wallet";
import { bigMoveLine } from "./BigMoveCard";
import { DailyCallCard } from "./DailyCallCard";
import { MeView, type MeData } from "./MeScreen";
import { watching } from "./ThinkingFeed";

const addr = (b: string) => `0x${b.repeat(20)}` as `0x${string}`;
const all = { BotRegistry: addr("21"), SeasonLedger: addr("22"), PaperLedger: addr("23"), DailyCall: addr("24"), Challenges: addr("25") };
const config: OwnerConfig = { workerUrl: "https://w", forwarder: addr("11"), targets: all };
const session = { address: addr("aa"), authKind: "privy", getAuthToken: async () => "t", signTypedData: async () => "0x" } as WalletSession;
const ctx = { config, session };
const h = (b: string) => `0x${b.repeat(32)}` as `0x${string}`;
const NOW = Date.parse("2026-11-26T10:00:00+05:30");

const owner = (over: Partial<OwnerBot> = {}): OwnerBot => ({
  botId: "7",
  name: "AlphaWolf",
  status: "active",
  proposal: null,
  calls: { season: 3, you: 4, bot: 3, streak: 2, today: null },
  ...over,
});
const move: PendingBigMove = {
  orderId: h("0e"),
  botId: "7",
  botName: "AlphaWolf",
  asset: "GOLD",
  side: "BUY",
  bps: 3500,
  deadline: new Date(NOW + 90 * 60_000).toISOString(),
  reason: "Gold is calm.",
  signed: { order: { botId: "7", asset: 4, buy: true, bps: 3500, decisionId: h("0d"), actionIndex: 0, deadline: "1795000000" }, runnerSig: "0x12" },
};

const view = (data: MeData) => renderToStaticMarkup(createElement(MeView, { data, ctx, now: NOW, onReload: () => {} }));

describe("MeView", () => {
  it("has a loading, an error, a no-bot and a not-indexed-yet state", () => {
    expect(view({ kind: "loading" })).toContain("Loading your bot");
    expect(view({ kind: "error", message: "Can't reach QIE right now." })).toContain("Try again");
    expect(view({ kind: "no_bot" })).toContain("zero real money is at risk");
    expect(view({ kind: "not_indexed", botId: "7" })).toContain("Bot #7 is on QIE");
  });

  it("shows the big move, controls, thinking feed, Daily Call, season and Bad call on every call", () => {
    const html = view({ kind: "ok", page: samplePage(), owner: owner(), daily: { day: 1, closesAt: "2026-11-26T14:30:00.000Z", bots: [{ botId: "7", botName: "AlphaWolf", state: "open" }] }, moves: [move] });
    expect(html).toContain("AlphaWolf wants to put 35% of its cash into Gold. Allow?");
    expect(html).toContain("Decide within 1h 30m");
    for (const text of ["Allow", "Shrink to safe size", "Block", "Pause bot", "Next call in 3h 0m · watching BTC", "BTC up or down", "Closes at 26 Nov, 20:00 IST", "Bad call", "Challenge a friend", "Season 1 result"]) {
      expect(html).toContain(text);
    }
    expect(html).toMatch(/You <b[^>]*>4<\/b> – <b[^>]*>3<\/b>/);
    expect(html).not.toMatch(/trustless|decentrali[sz]ed|zero risk/i);
  });

  it("links an open v2 proposal with its approval deadline", () => {
    const config2 = { version: 2, season: 3, rules: "r", max_per_coin_bps: 2500, max_trades_per_day: 4, from: { version: 1, rules: "r", max_per_coin_bps: 4000, max_trades_per_day: 4 }, changes: [{ what: "x", because_correction_id: 1 }], approve_by: "2026-11-27T03:00:00.000Z" };
    const html = view({ kind: "ok", page: samplePage(), owner: owner({ proposal: { version: 2, configHash: h("ab"), config: config2, approveBy: config2.approve_by } }), daily: null, moves: [] });
    expect(html).toContain('href="/season/3"');
    expect(html).toContain("Approve by 27 Nov, 08:30 IST, or it keeps v1");
  });

  it("still shows the bot when the owner reads fail", () => {
    const html = view({ kind: "ok", page: samplePage(), owner: null, daily: null, moves: [] });
    expect(html).toContain("AlphaWolf");
    expect(html).toContain("Daily Call and your season scores didn");
  });
});

describe("DailyCallCard", () => {
  const card = (props: Partial<Parameters<typeof DailyCallCard>[0]>) =>
    renderToStaticMarkup(createElement(DailyCallCard, { ctx, bot: owner(), state: "open", closesAt: null, now: NOW, ...props }));
  const called = { userUp: true, botUp: false, callTx: h("01"), settleTx: null, userCorrect: null, botCorrect: null };

  it("never shows the bot's view before the owner has picked and signed", () => {
    const html = card({});
    expect(html).toContain("▲ Up");
    expect(html).not.toContain("says");
  });

  it("shows the result, the settle-late note and the explorer link of the owner's call", () => {
    const settled = card({ bot: owner({ calls: { season: 3, you: 1, bot: 0, streak: 1, today: { ...called, settleTx: h("02"), userCorrect: true, botCorrect: false } } }) });
    expect(settled).toContain("You were right · AlphaWolf was wrong");
    expect(settled).toContain(`https://mainnet.qie.digital/tx/${h("01")}`);
    const late = card({ bot: owner({ calls: { season: 3, you: 0, bot: 0, streak: 0, today: called } }), now: Date.parse("2026-11-26T22:00:00+05:30") });
    expect(late).toContain("Settles late");
    expect(card({ bot: owner({ calls: { season: 3, you: 0, bot: 0, streak: 0, today: called } }) })).toContain("Settles after tonight");
  });

  it("explains every state without a call", () => {
    expect(card({ state: "joins_tomorrow" })).toContain("Your bot joins tomorrow");
    expect(card({ state: "closed" })).toContain("closed at 20:00 IST");
    expect(card({ state: "waiting" })).toContain("09:00 IST");
    expect(card({ state: null })).toContain("didn&#x27;t load");
    expect(card({ ctx: { config: { ...config, targets: { ...all, DailyCall: undefined } }, session } })).toContain("switched on yet");
  });
});

it("words big moves from the order: a BUY is a share of cash, a SELL a share of the holding", () => {
  expect(bigMoveLine({ botName: "A", side: "SELL", bps: 5000, asset: "SOL" })).toBe("A wants to sell 50% of its Solana. Allow?");
  expect(bigMoveLine({ botName: "A", side: "BUY", bps: 3250, asset: "BTC" })).toBe("A wants to put 32.5% of its cash into Bitcoin. Allow?");
});

it("watches the biggest holding, else BTC", () => {
  const page = samplePage();
  expect(watching(page)).toBe("BTC");
  page.mark!.holdings = [...page.mark!.holdings, { asset: "GOLD", units_e18: "1", value_e8: "99000000000" }];
  expect(watching(page)).toBe("GOLD");
  expect(watching({ mark: null })).toBe("BTC");
});
