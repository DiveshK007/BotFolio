import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { samplePage } from "@/lib/bot-record.fixture";
import type { OwnerConfig } from "@/lib/config";
import type { OwnerBot, PendingBigMove } from "@/lib/owner";
import type { BotCardLink } from "@/lib/site/data";
import type { WalletSession } from "@/lib/wallet";
import { bigMoveLine } from "./BigMoveCard";
import { DailyCallCard } from "./DailyCallCard";
import { MeSignIn, MeView, nextVisibleClose, SignedInAs, type MeData } from "./MeScreen";
import { ActionStatus, refusalMessage, SignInCard } from "./relay-ui";
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
    const html = view({ kind: "ok", page: samplePage(), owner: owner(), daily: { day: 1, closesAt: "2026-11-26T14:30:00.000Z", bots: [{ botId: "7", botName: "AlphaWolf", state: "open" }] }, moves: [move], cards: [] });
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
    const html = view({ kind: "ok", page: samplePage(), owner: owner({ proposal: { version: 2, configHash: h("ab"), config: config2, approveBy: config2.approve_by } }), daily: null, moves: [], cards: [] });
    expect(html).toContain('href="/season/3"');
    expect(html).toContain("Approve by 27 Nov, 08:30 IST, or it keeps v1");
  });

  it("dates the first result at the next visible close, never the hidden S0 one (#360)", () => {
    const page = { ...samplePage(), seasons: [] };
    expect(view({ kind: "ok", page, owner: owner(), daily: null, moves: [], cards: [] })).toContain("next close, 30 Nov, 21:30 IST");
    const at = (ist: string) => nextVisibleClose(Date.parse(`${ist}+05:30`));
    expect(at("2026-11-27T02:30:00")).toBe("2026-11-30T16:00:00.000Z"); // during S0
    expect(at("2026-11-30T21:30:00")).toBe("2026-12-02T16:00:00.000Z"); // S1 just closed
    expect(at("2026-12-06T22:00:00")).toBe("2026-12-13T16:00:00.000Z"); // after the sprints: Sunday 21:30
    expect(at("2026-12-13T21:30:00")).toBe("2026-12-20T16:00:00.000Z");
  });

  it("lists the bot's cards, each linking to /card/<id>, with an empty and a failed state (#82)", () => {
    const withCards = (cards: BotCardLink[] | null) => view({ kind: "ok", page: samplePage(), owner: owner(), daily: null, moves: [], cards });
    const html = withCards([{ id: "trade-12", headline: "Bought BTC", createdAt: "2026-11-27T04:00:00.000Z" }]);
    expect(html).toContain("Your cards");
    expect(html).toContain('href="/card/trade-12"');
    expect(html).toContain("Bought BTC");
    expect(html).toContain("27 Nov, 09:30 IST");
    expect(withCards([])).toContain("Your first card appears after your bot&#x27;s first trade.");
    expect(withCards(null)).toContain("Your cards didn&#x27;t load");
  });

  it("still shows the bot when the owner reads fail", () => {
    const html = view({ kind: "ok", page: samplePage(), owner: null, daily: null, moves: [], cards: [] });
    expect(html).toContain("AlphaWolf");
    expect(html).toContain("Daily Call and your season scores didn");
  });

  it("says so when the big-moves read fails, instead of showing none waiting (#89)", () => {
    const html = view({ kind: "ok", page: samplePage(), owner: owner(), daily: null, moves: null, cards: [] });
    expect(html).toContain("Big moves waiting for your OK didn&#x27;t load");
    expect(view({ kind: "ok", page: samplePage(), owner: owner(), daily: null, moves: [], cards: [] })).not.toContain("Big moves waiting");
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

describe("relay refusals (#326)", () => {
  it("words PICK_MISMATCH and TERMS_NOT_ACCEPTED, and sends the latter to the 18+ / Terms step", async () => {
    const { FlowError } = await import("@/lib/errors");
    expect(refusalMessage(new FlowError("PICK_MISMATCH", "x"))).toContain("your first pick stands");
    expect(refusalMessage(new FlowError("WOULD_REVERT", "Price too old."))).toBe("Price too old.");
    const html = renderToStaticMarkup(
      createElement(ActionStatus, { phase: { name: "error", code: "TERMS_NOT_ACCEPTED", message: refusalMessage(new FlowError("TERMS_NOT_ACCEPTED", "x")) }, done: "" }),
    );
    expect(html).toContain("18 or older");
    expect(html).toContain('href="/"');
  });
});

describe("SignInCard", () => {
  const w = (available: boolean) => ({ available, signIn: async () => session });
  const card = (passkey: boolean, qie: boolean) => renderToStaticMarkup(createElement(SignInCard, { why: "Sign in.", wallets: { passkey: w(passkey), qie: w(qie) } }));

  it("offers whichever wallet the device has, and says not live only when it has neither", () => {
    expect(card(true, false)).toContain("Sign in with passkey");
    expect(card(true, false)).not.toContain("Connect QIE Wallet");
    expect(card(false, true)).toContain("Connect QIE Wallet");
    expect(card(false, true)).not.toContain("live yet");
    expect(card(false, false)).toContain("live yet");
  });

  it("on /me, sends new users to the home page's 18+ sign-up first (#93)", () => {
    const html = renderToStaticMarkup(createElement(MeSignIn, { wallets: { passkey: w(true), qie: w(false) } }));
    expect(html).toContain("New here?");
    expect(html).toContain('href="/"');
    expect(html).toContain("Already have a bot? Sign in");
  });

  it("shows who is signed in, with a Sign out button", () => {
    const html = renderToStaticMarkup(createElement(SignedInAs, { address: addr("ab"), onSignOut: () => {} }));
    expect(html).toContain("Signed in as");
    expect(html).toContain("0xabab…abab");
    expect(html).toContain("Sign out");
  });
});

describe("pending challenge (newcomer path)", () => {
  it("keeps only an 8-byte hex code, and hands it over once", async () => {
    const store = new Map<string, string>();
    const { savePendingChallenge, takePendingChallenge } = await import("@/lib/draft");
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    savePendingChallenge("../evil");
    expect(takePendingChallenge()).toBeNull();
    savePendingChallenge("c0".repeat(8));
    expect(takePendingChallenge()).toBe("c0".repeat(8));
    expect(takePendingChallenge()).toBeNull();
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  });
});
