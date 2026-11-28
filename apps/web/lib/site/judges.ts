/**
 * /judges data from the worker (HANDOFF follow-up #2), the same public reads the app uses:
 *  - traction: GET /stats (lib/stats.ts), mapped onto the site's ActivityStats tiles;
 *  - latest trades: GET /leaderboards for the bots on the board (else GET /bots), then GET /bot-page for each (no trades feed yet).
 * No worker configured → traction says "counting starts at deploy" and trades fall back to labelled EXAMPLE data.
 * A worker that fails → error state with the proof link. Never made-up numbers in live mode.
 */
import { getWorkerUrl } from "@/lib/config";
import { ageAtCall, fetchBotPage, type BotPage, type BotPageResult } from "@/lib/bot-record";
import { fetchBots, type PublicBot } from "@/lib/bots";
import { fetchLeaderboards, type Leaderboards } from "@/lib/leaderboards";
import { fetchStats, type ActivityStats as WorkerStats, type StatsResult } from "@/lib/stats";
import { SAMPLE_TRADES } from "./sample";
import type { ActivityStats, Loaded, Trade } from "./types";

const EXPLORER = "https://mainnet.qie.digital";
/** How many bots' pages to read for the trades feed. Small: Vercel reads count as one caller to the worker (#156). */
export const TRADE_BOTS = 4;
export const TRADE_ROWS = 5;

export function toSiteActivity(s: WorkerStats): ActivityStats {
  const a = s.userSigned.byAction;
  const k = s.system.byKind;
  return {
    uniqueSigners: s.userSigned.signers,
    userSignedTxs: s.userSigned.txs,
    botsCreated: a.createBot.txs,
    corrections: a.correction.txs,
    v2Approvals: a.approveV2.txs,
    approvedBigMoves: a.bigMove.txs,
    dailyCalls: a.dailyCall.txs,
    challenges: a.challengeCreate.txs + a.challengeAccept.txs,
    system: { runnerBatches: k.runnerTrades, dailyCallSettlements: k.dailyCallSettles, seasonRoots: k.seasonCloses + k.scoreCommits },
  };
}

export function activityFrom(r: StatsResult): Loaded<ActivityStats> {
  if (r.kind === "ok") return { status: "live", data: toSiteActivity(r.stats), updatedAt: r.stats.asOf, source: "/stats" };
  if (r.kind === "not_live") return { status: "notlive", data: null, updatedAt: null, source: EXPLORER };
  return { status: "error", data: null, updatedAt: new Date().toISOString(), source: "/stats" };
}

export async function judgesActivity(): Promise<Loaded<ActivityStats>> {
  return activityFrom(await fetchStats());
}

/** $ display value: 100000 × cash / startCash (SPEC §3). */
const inrDisplay = (cashE8: string, startE8: string) => {
  const start = Number(startE8);
  return start > 0 ? Math.round((100000 * Number(cashE8)) / start) : 0;
};

export function tradesFromPages(pages: BotPage[], limit = TRADE_ROWS): Trade[] {
  const rows: Trade[] = [];
  for (const p of pages) {
    const bot = { id: Number(p.bot.id), name: p.bot.name, emoji: p.bot.emoji, dnaSeed: p.bot.dna_seed ?? null, isHouse: p.bot.is_house, ownerWallet: p.bot.owner_wallet as `0x${string}` };
    for (const t of p.trades) {
      rows.push({
        botId: bot.id, asset: t.asset, side: t.side, cashE8: t.cash_e8, priceE8: t.price_e8, roundId: t.round_id,
        txHash: t.tx_hash as `0x${string}`, blockTime: t.slot_time, userSigned: t.owner_signed, inrDisplay: inrDisplay(t.cash_e8, p.start_cash_e8), age: ageAtCall(t), bot,
      });
    }
  }
  return rows.sort((x, y) => Date.parse(y.blockTime) - Date.parse(x.blockTime)).slice(0, limit);
}

/** Distinct bots on the boards, board order, at most n. */
export function boardBotIds(b: Leaderboards, n = TRADE_BOTS): string[] {
  const ids: string[] = [];
  for (const e of [...b.topReturns, ...b.mostTrusted, ...b.coachVsBot, ...b.bestRiskAdjusted]) {
    if (!ids.includes(e.botId)) ids.push(e.botId);
    if (ids.length >= n) break;
  }
  return ids;
}

/** No board yet (S0 stays hidden, #219): real bots from GET /bots, house bots first since they trade every call. */
export function listedBotIds(bots: PublicBot[], n = TRADE_BOTS): string[] {
  return [...bots.filter(b => b.isHouse), ...bots.filter(b => !b.isHouse)].slice(0, n).map(b => b.botId);
}

export async function judgesTrades(
  base: string | null = getWorkerUrl(),
  boards: (base: string) => Promise<Leaderboards> = async u => (await fetchLeaderboards(u, null, AbortSignal.timeout(8000))).boards,
  page: (id: string, base: string) => Promise<BotPageResult> = (id, u) => fetchBotPage(id, u),
  bots: (base: string) => Promise<PublicBot[] | null> = fetchBots,
): Promise<Loaded<Trade[]>> {
  if (!base) return { status: "example", data: SAMPLE_TRADES, updatedAt: "2026-11-26T07:30:00Z", source: "sample" };
  try {
    let ids = await boards(base).then(b => boardBotIds(b), () => []);
    if (ids.length === 0) {
      const all = await bots(base);
      if (!all) throw new Error("no bot list");
      ids = listedBotIds(all);
    }
    const results = await Promise.all(ids.map(id => page(id, base)));
    if (results.some(r => r.kind === "error" || r.kind === "busy")) throw new Error("bot-page failed");
    const pages = results.flatMap(r => (r.kind === "ok" ? [r.page] : []));
    return { status: "live", data: tradesFromPages(pages), updatedAt: new Date().toISOString(), source: EXPLORER };
  } catch {
    return { status: "error", data: null, updatedAt: new Date().toISOString(), source: EXPLORER };
  }
}
