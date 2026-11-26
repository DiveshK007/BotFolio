/**
 * EXAMPLE data for the website until the contracts (~Nov 22) and app (~Nov 25) are live.
 * Every block rendered from this file MUST carry an EXAMPLE badge (status: "example").
 * Hashes and addresses are deliberately patterned (0xe0a1…, 0x5eed…, 0xc0f1…) so nobody
 * mistakes them for real ones, and TxChip never links them to the explorer.
 * BTC round 50887 and Gold round 14811 / $3,730.84 come from SPEC examples; other prices are made up.
 */
import type { AssetId } from "@botfolio/shared";
import type { Bot, BotRecord, CardPayload, Leaderboards, Trade } from "./types";

const exHash = (n: number) => `0x${"e0a1".padEnd(60, "0")}${String(n).padStart(4, "0")}` as `0x${string}`;
const exCfg = (n: number) => `0x${"c0f1".padEnd(60, "0")}${String(n).padStart(4, "0")}` as `0x${string}`;
const exAddr = (n: number) => `0x5eed${"0".repeat(32)}${String(n).padStart(4, "0")}` as `0x${string}`;
export const isExampleHash = (h: string) => h.startsWith("0xe0a1") || h.startsWith("0xc0f1");

export const SAMPLE_PRICES: Record<AssetId, { price: number; roundId: string; ageMin: number }> = {
  BTC: { price: 63922.95, roundId: "50887", ageMin: 1 },
  ETH: { price: 3412.18, roundId: "40219", ageMin: 8 },
  SOL: { price: 148.62, roundId: "31207", ageMin: 12 },
  XRP: { price: 2.1834, roundId: "28844", ageMin: 4 },
  GOLD: { price: 3730.84, roundId: "14811", ageMin: 180 },
};

export const SAMPLE_BOTS: Record<number, Bot> = {
  12: { id: 12, name: "Gold Guru", emoji: "🪙", color: "#E0A400", ownerWallet: exAddr(12), personaText: "Careful like my dad, loves gold", isHouse: false },
  7: { id: 7, name: "AlphaWolf", emoji: "🐺", color: "#5B6475", ownerWallet: exAddr(7), personaText: "Aggressive, chases whatever is moving", isHouse: false },
  21: { id: 21, name: "Dip Doctor", emoji: "🩺", color: "#0E9F8E", ownerWallet: exAddr(21), isHouse: false },
  33: { id: 33, name: "Slow Lane", emoji: "🐢", color: "#3E8E41", ownerWallet: exAddr(33), isHouse: false },
  41: { id: 41, name: "HODL Hippo", emoji: "🦛", color: "#8E6CCB", ownerWallet: exAddr(41), isHouse: false },
  52: { id: 52, name: "XRP Express", emoji: "🚄", color: "#2B6CD9", ownerWallet: exAddr(52), isHouse: false },
  58: { id: 58, name: "Chai Break", emoji: "☕", color: "#B0643A", ownerWallet: exAddr(58), isHouse: false },
  1: { id: 1, name: "Steady Sam", emoji: "⚖️", color: "#6B7280", ownerWallet: exAddr(1), isHouse: true, houseRule: "Equal 20% in all 5 assets" },
  2: { id: 2, name: "Gold Granny", emoji: "👵", color: "#C9A227", ownerWallet: exAddr(2), isHouse: true, houseRule: "60% Gold, 40% cash" },
  3: { id: 3, name: "Momentum Max", emoji: "🚀", color: "#D9480F", ownerWallet: exAddr(3), isHouse: true, houseRule: "Holds whatever rose 2% in 24 h" },
};

const t = (botId: number, side: "BUY" | "SELL", asset: AssetId, inrDisplay: number, iso: string, n: number, userSigned = false): Trade => ({
  botId, side, asset, inrDisplay, userSigned, blockTime: iso, txHash: exHash(n),
  cashE8: "0", priceE8: String(Math.round(SAMPLE_PRICES[asset].price * 1e8)), roundId: SAMPLE_PRICES[asset].roundId,
});

export const SAMPLE_TRADES: Trade[] = [
  t(12, "BUY", "GOLD", 25000, "2026-11-26T07:30:00Z", 11),
  t(21, "BUY", "SOL", 20000, "2026-11-26T07:30:00Z", 12),
  t(7, "BUY", "GOLD", 40000, "2026-11-26T03:30:00Z", 13, true),
  t(3, "BUY", "BTC", 25000, "2026-11-26T03:30:00Z", 14),
  t(33, "SELL", "ETH", 8000, "2026-11-26T03:30:00Z", 15),
];

const row = (id: number, returnPct: number, valueDisplay: number, trades: number, trust: number) => ({
  bot: SAMPLE_BOTS[id], returnPct, valueDisplay, trades, trust: trades < 8 && !SAMPLE_BOTS[id].isHouse ? null : trust,
});
const ALL = [row(21, 5.1, 105100, 11, 540), row(3, 4.2, 104200, 12, 610), row(12, 3.42, 103420, 9, 684), row(58, 2.3, 102300, 3, 0),
  row(1, 1.85, 101850, 5, 702), row(41, 1.2, 101200, 4, 598), row(2, 0.95, 100950, 2, 690), row(33, 0.6, 100600, 10, 731),
  row(52, -0.8, 99200, 8, 455), row(7, -12.4, 87600, 14, 312)];

export const SAMPLE_BOARDS: Leaderboards = {
  season: 1,
  returns: ALL,
  risk: [], // nobody qualifies in a 2-day sprint season (≥3 daily returns needed)
  trusted: ALL.filter(r => r.trades >= 8).sort((a, b) => (b.trust ?? 0) - (a.trust ?? 0)),
  coach: [
    { owner: exAddr(12), bot: SAMPLE_BOTS[12], you: 2, botScore: 0 },
    { owner: exAddr(33), bot: SAMPLE_BOTS[33], you: 2, botScore: 1 },
    { owner: exAddr(21), bot: SAMPLE_BOTS[21], you: 1, botScore: 1 },
    { owner: exAddr(7), bot: SAMPLE_BOTS[7], you: 1, botScore: 2 },
  ],
};

export const SAMPLE_RECORD_12: BotRecord = {
  bot: SAMPLE_BOTS[12],
  valueDisplay: 103420,
  seasonReturnPct: 3.42,
  holdings: [{ asset: "GOLD", weightPct: 30, inrDisplay: 31026 }, { asset: "BTC", weightPct: 15, inrDisplay: 15513 }, { asset: "CASH", weightPct: 55, inrDisplay: 56881 }],
  decisions: [
    { slotTime: "2026-11-27T07:30:00Z", status: "executed", reason: "Bought a little BTC after two calm days; gold already near its cap.", reasonTag: "rebalance" },
    { slotTime: "2026-11-27T03:30:00Z", status: "held", reason: "Holding. Gold is fine, BTC is jumpy, and patience is a strategy.", reasonTag: "stay_cash" },
    { slotTime: "2026-11-26T15:30:00Z", status: "executed", reason: "Added Gold on a small dip, still under 35% of the portfolio.", reasonTag: "buy_dip" },
    { slotTime: "2026-11-26T07:30:00Z", status: "executed", reason: "First trade: Gold, the way Dad would.", reasonTag: "persona_preference" },
  ],
  trades: [
    t(12, "BUY", "BTC", 15000, "2026-11-27T07:30:00Z", 21),
    t(12, "BUY", "GOLD", 6000, "2026-11-26T15:30:00Z", 22),
    t(12, "BUY", "GOLD", 25000, "2026-11-26T07:30:00Z", 23),
  ],
  versions: [
    { version: 2, rulesText: "Keeps a cushion of cash · likes Gold · small BTC after calm days", maxPerCoinBps: 3500, maxTradesPerDay: 3, configHash: exCfg(12), source: "season_v2", committedTx: exHash(24), approvedAt: "2026-11-27T16:11:00Z",
      changes: [{ because: 'You said "too timid" 2×', what: "Max per coin", from: "30%", to: "35%" }] },
    { version: 1, rulesText: "Keeps a big cushion of cash · likes Gold · max per coin 30% · 3 trades a day", maxPerCoinBps: 3000, maxTradesPerDay: 3, configHash: exCfg(11), source: "create", committedTx: exHash(25), approvedAt: "2026-11-26T07:28:00Z" },
  ],
  trust: { rulesVersion: "trust-v1-sprint", fRules: 238, fDrawdown: 201, fConsistency: 125, fExplains: 120, total: 684, provisional: false },
  tradesCount: 9,
};

export const SAMPLE_CARDS: Record<string, CardPayload> = {
  "example-challenge": { id: "example-challenge", kind: "challenge", bot: SAMPLE_BOTS[58], opponent: SAMPLE_BOTS[12], season: 2, trust: 0, headline: "Chai Break wants to race Gold Guru this season.", line: "Make a bot in 30 seconds. The season decides. No stakes.",
    proofs: [{ label: "Challenge tx", txHash: exHash(38), whatItProves: "The challenge is created on-chain by the challenger, so the matchup and season are fixed." }] },
  "example-roast": { id: "example-roast", kind: "roast", bot: SAMPLE_BOTS[7], season: 1, trust: 312, headline: "AlphaWolf lost $12,400 going big on Gold at the 21:00 call.", line: "Trust score 312. Roast him.",
    proofs: [
      { label: "Trade tx", txHash: exHash(31), whatItProves: "Bought Gold at $3,730.84, priced by QIE oracle round 14811, not by us.", oracle: { asset: "GOLD", roundId: "14811" } },
      { label: "Mark at close", txHash: exHash(32), whatItProves: "The loss uses the 21:00 oracle marks, recorded with their round ids, so anyone can recompute it." },
      { label: "Bot version", txHash: exHash(33), whatItProves: "AlphaWolf was on v1 when it made this call." },
    ] },
  "example-evolution": { id: "example-evolution", kind: "evolution", bot: SAMPLE_BOTS[7], season: 1, trust: 312, headline: 'You said "too risky" 3× → max per coin 40% → 25%', line: "AlphaWolf v2, approved by its owner.",
    proofs: [
      { label: "Version commit", txHash: exHash(34), whatItProves: "v2's config hash was committed by the owner's own signature." },
      { label: "Corrections", txHash: exHash(35), whatItProves: 'Three "too risky" corrections, each a signed tx, are what v2 points to.' },
    ] },
};
