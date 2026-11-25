import type { CardBot, CardCitation, CardPayload, CardValue, RecapCardPayload, RoastCardPayload, TradeCardPayload } from "@botfolio/shared";

/**
 * Mock card payloads for #102, shaped like what the worker writes to `cards.payload` (apps/worker/src/cards).
 * Ids end in "-mock" so they can't collide with real ids (`trade-<botId>`, `roast-<botId>-<slotId>`, `recap-<botId>-<day>`).
 * shortcut: the route serves only these; replace `loadCard` with a worker fetch when real cards are wired up.
 */

const TX1 = "0x5f2c8e1a9b3d4c6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6" as const;
const TX2 = "0x9a1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677889900aabbccddeeff" as const;
const START = "1000000000000"; // 10,000 play USDT, E8

const bot: CardBot = {
  botId: "7",
  name: "AlphaWolf",
  emoji: "🐺",
  ownerAddress: "0x1234567890abcdef1234567890abcdef12345678",
  ownerQieName: "ravi.qie",
  isHouse: false,
};

const btc = (priceE8: string, roundId: string, updatedAt: string, readAt: string) =>
  ({ asset: "BTC", priceE8, roundId, updatedAt, readAt }) as const;

const value = (valueE8: string, markedAt: string): CardValue => ({
  valueE8,
  startCashE8: START,
  markedAt,
  oldestPrice: btc("6392295000000", "50887", new Date(Date.parse(markedAt) - 120_000).toISOString(), markedAt),
});

const tradeCite = (txHash: `0x${string}`, roundId: string): CardCitation => ({
  event: "trade",
  txHash,
  oracle: { asset: "BTC", roundId },
  proves: `This trade was priced by QIE's oracle round ${roundId}, not by us`,
});

const trade: TradeCardPayload = {
  schemaVersion: 1,
  kind: "trade",
  cardId: "trade-mock",
  createdAt: "2026-11-24T09:31:00.000Z",
  bot,
  seasonId: 3,
  value: value("1003420000000", "2026-11-24T09:30:00.000Z"),
  change: { bps: 34, deltaE8: "3420000000", since: "start" },
  trust: { total: 612, provisional: true, rulesVersion: "1" },
  line: { source: "reason", decisionId: "101", text: "BTC held its range all night; buying a small slice and keeping most in cash." },
  cites: [tradeCite(TX1, "50887")],
  trade: {
    decisionId: "101",
    actionIndex: 0,
    side: "BUY",
    cashE8: "200000000000",
    unitsE18: "31288000000000000",
    price: btc("6392295000000", "50887", "2026-11-24T09:28:00.000Z", "2026-11-24T09:30:00.000Z"),
    approvedByOwner: false,
    txHash: TX1,
  },
};

const roast: RoastCardPayload = {
  schemaVersion: 1,
  kind: "roast",
  cardId: "roast-mock",
  createdAt: "2026-11-24T15:31:00.000Z",
  bot,
  seasonId: 3,
  value: value("958000000000", "2026-11-24T15:30:00.000Z"),
  change: { bps: -451, deltaE8: "-45300000000", since: "slot" },
  trust: { total: 588, provisional: false, rulesVersion: "1" },
  line: { source: "roast", decisionId: "118", text: "I bought the top with confidence and sold the bottom with conviction. Consistency matters." },
  cites: [tradeCite(TX2, "50912"), tradeCite(TX1, "50887")],
  roast: { trigger: "slot_loss", slotTime: "2026-11-24T15:30:00.000Z", lossBps: 451, lossE8: "45300000000" },
};

const recap: RecapCardPayload = {
  schemaVersion: 1,
  kind: "recap",
  cardId: "recap-mock",
  createdAt: "2026-11-24T16:05:00.000Z",
  bot,
  seasonId: 3,
  value: value("1012600000000", "2026-11-24T15:30:00.000Z"),
  change: { bps: 126, deltaE8: "12600000000", since: "day" },
  trust: { total: 640, provisional: false, rulesVersion: "1" },
  line: { source: "reason", decisionId: "120", text: "Gold price is 3h old, so I'm holding until it updates." },
  cites: [tradeCite(TX1, "50887"), tradeCite(TX2, "50912")],
  recap: {
    day: 20416,
    best: {
      decisionId: "101",
      actionIndex: 0,
      side: "BUY",
      price: btc("6392295000000", "50887", "2026-11-24T09:28:00.000Z", "2026-11-24T09:30:00.000Z"),
      pnlBps: 218,
      reason: "BTC held its range all night; buying a small slice.",
      txHash: TX1,
    },
    worst: {
      decisionId: "118",
      actionIndex: 0,
      side: "SELL",
      price: btc("6311000000000", "50912", "2026-11-24T15:27:00.000Z", "2026-11-24T15:30:00.000Z"),
      pnlBps: -95,
      reason: "Cutting BTC after the drop.",
      txHash: TX2,
    },
    rank: { position: 3, of: 41 },
  },
};

const FIXTURES: Record<string, CardPayload> = { [trade.cardId]: trade, [roast.cardId]: roast, [recap.cardId]: recap };

/** The seam the worker fetch replaces: a card id in, its stored payload (or null) out. */
export async function loadCard(cardId: string): Promise<CardPayload | null> {
  return FIXTURES[cardId] ?? null;
}

export const MOCK_CARDS = { trade, roast, recap };
