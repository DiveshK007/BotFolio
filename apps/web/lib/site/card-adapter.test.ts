import { afterEach, describe, expect, it, vi } from "vitest";
import type { CallCardPayload, ChallengeCardPayload, RecapCardPayload } from "@botfolio/shared";
import { MOCK_CARDS } from "@/app/api/card/fixtures";
import { isStoredCard, toSiteCard } from "./card-adapter";

// Shaped like apps/worker/src/cards (build.ts tradeCitation, close-cards.ts challenge/call cites).
const { trade, recap } = MOCK_CARDS;
const TX3 = `0x${"0".repeat(63)}3` as const;
const quiet: RecapCardPayload = { ...recap, cardId: "recap-7-20416", cites: [], recap: { ...recap.recap, best: null, worst: null, rank: null } };
const other = { ...trade.bot, botId: "9", name: "Chai Break", emoji: "☕" };
const challenge: ChallengeCardPayload = {
  ...trade, kind: "challenge", cardId: "challenge-00000000000000ab-7", seasonId: 3, line: null, trust: null,
  cites: [
    { event: "challenge_settled", txHash: TX3, oracle: null, proves: "The winner was settled on QIE from the season's results" },
    { event: "season_closed", txHash: TX3, oracle: null, proves: "Season 3's replay file root is on QIE: anyone can recompute these results" },
  ],
  challenge: { code: `0x${"ab".repeat(32)}`, challenger: { bot: other, returnBps: 120, maxDdBps: 300 }, opponent: { bot: trade.bot, returnBps: -40, maxDdBps: 500 }, winnerBotId: "9", txHash: TX3 },
};
const call: CallCardPayload = {
  ...trade, kind: "call", cardId: "call-7-20416", seasonId: null, line: null,
  cites: [{ event: "daily_call", txHash: TX3, oracle: { asset: "BTC", roundId: "50887" }, proves: "The call was priced by QIE's BTC round 50887" }],
  call: { day: 20416, userUp: true, botUp: false, userCorrect: true, botCorrect: false, priceAtCall: trade.trade.price, settlePrice: trade.trade.price, score: { user: 4, bot: 3 }, streak: 2, callTxHash: TX3, settleTxHash: TX3 },
};

describe("toSiteCard", () => {
  it("maps a worker trade card: bot, season, trust, the PNG's headline, and cites with their oracle round", () => {
    const c = toSiteCard(trade);
    expect(c).toMatchObject({ id: "trade-mock", kind: "trade", season: 3, trust: 612, line: trade.line.text, headline: "BUY Bitcoin · $20,000" });
    expect(c.bot).toEqual({ id: 7, ownerWallet: trade.bot.ownerAddress, name: "AlphaWolf", emoji: "🐺", isHouse: false, qieName: "ravi.qie" });
    expect(c.proofs).toEqual([{ label: "Trade tx", txHash: trade.cites[0]!.txHash, whatItProves: trade.cites[0]!.proves, oracle: { asset: "BTC", roundId: "50887" } }]);
  });

  it("keeps a quiet recap with no cites, and null season and trust as null", () => {
    const c = toSiteCard({ ...quiet, seasonId: null, trust: null });
    expect(c).toMatchObject({ proofs: [], season: null, trust: null });
  });

  it("puts the other bot of a challenge in `opponent`, from either side", () => {
    expect(toSiteCard(challenge)).toMatchObject({ opponent: { id: 9, name: "Chai Break" }, headline: "Chai Break vs AlphaWolf: Chai Break wins, +1.20%" });
    expect(toSiteCard({ ...challenge, bot: other }).opponent).toMatchObject({ id: 7 });
    expect(toSiteCard(challenge).proofs.map(p => p.label)).toEqual(["Challenge settled", "Season close"]);
  });

  it("writes a call headline from the score, with no line", () => {
    expect(toSiteCard(call)).toMatchObject({ headline: "You 4 – AlphaWolf 3", line: "", season: null });
  });
});

describe("isStoredCard", () => {
  it("takes a worker payload and turns away a raw site_cards row or junk", () => {
    expect(isStoredCard(trade)).toBe(true);
    expect(isStoredCard({ id: "trade-7", bot_id: "7", kind: "trade", payload: trade, created_at: trade.createdAt })).toBe(false);
    expect(isStoredCard({ ...trade, kind: "nft" })).toBe(false);
    expect(isStoredCard(null)).toBe(false);
  });
});

describe("getCard / getStoredCard in live mode", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const live = async (rows: unknown) => {
    vi.stubEnv("SITE_DATA_MODE", "live");
    vi.stubEnv("SUPABASE_URL", "https://db.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    const fetch = vi.fn(async () => Response.json(rows));
    vi.stubGlobal("fetch", fetch);
    vi.resetModules(); // SITE_MODE is read once at import
    return { data: await import("./data"), fetch };
  };

  it("reads the payload column and renders it as a live card", async () => {
    const { data, fetch } = await live([{ payload: trade }]);
    const c = await data.getCard("trade-7");
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe("https://db.example/rest/v1/site_cards?id=eq.trade-7&select=payload");
    expect(c).toMatchObject({ status: "live", data: { kind: "trade", bot: { name: "AlphaWolf" } } });
  });

  it("shows the error fallback for a missing card or a payload it can't read, never a crash", async () => {
    for (const rows of [[], [{ payload: { kind: "trade" } }]]) {
      const { data } = await live(rows);
      expect(await data.getCard("trade-7")).toMatchObject({ status: "error", data: null });
    }
  });

  it("still serves the example-* demo cards, marked as examples", async () => {
    const { data, fetch } = await live([]);
    expect(await data.getCard("example-evolution")).toMatchObject({ status: "example", data: { id: "example-evolution" } });
    expect(await data.getCard("toString")).toMatchObject({ status: "error" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
