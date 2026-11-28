import { describe, expect, it, vi } from "vitest";
import { samplePage } from "@/lib/bot-record.fixture";
import type { Leaderboards } from "@/lib/leaderboards";
import type { ActivityStats } from "@/lib/stats";
import { activityFrom, boardBotIds, judgesTrades, listedBotIds, toSiteActivity, tradesFromPages } from "./judges";
import type { PublicBot } from "@/lib/bots";

const bot = (botId: string, isHouse: boolean): PublicBot => ({ botId, name: `B${botId}`, emoji: "", isHouse, version: 1, createdAt: "2026-11-26T00:00:00Z" });

const stats: ActivityStats = {
  asOf: "2026-11-25T12:00:00.000Z",
  userSigned: {
    txs: 7, signers: 2, active7d: 1, active30d: 1, recurring: 1,
    byAction: {
      createBot: { txs: 2, wallets: 2 }, approveV2: { txs: 0, wallets: 0 }, correction: { txs: 1, wallets: 1 }, bigMove: { txs: 1, wallets: 1 },
      dailyCall: { txs: 1, wallets: 1 }, challengeCreate: { txs: 1, wallets: 1 }, challengeAccept: { txs: 1, wallets: 1 },
    },
  },
  system: { txs: 6, byKind: { runnerTrades: 3, dailyCallSettles: 1, seasonCloses: 1, scoreCommits: 1, houseBots: 2 } },
};
const entry = (botId: string) => ({ botId, name: `B${botId}`, emoji: "", isHouse: false, ownerQieName: null, rank: 1 });
const boards: Leaderboards = {
  season: 1, live: true, trustSeason: 1,
  topReturns: [{ ...entry("7"), returnBps: 10, maxDdBps: 1 }, { ...entry("8"), returnBps: 5, maxDdBps: 1 }],
  bestRiskAdjusted: [], mostTrusted: [{ ...entry("7"), total: 800 }, { ...entry("9"), total: 700 }], coachVsBot: [],
};

describe("judges activity from GET /stats", () => {
  it("maps the worker's split onto the tiles without mixing system txs in", () => {
    const a = toSiteActivity(stats);
    expect(a).toMatchObject({ uniqueSigners: 2, userSignedTxs: 7, botsCreated: 2, challenges: 2, system: { runnerBatches: 3, dailyCallSettlements: 1, seasonRoots: 2 } });
  });
  it("keeps not-live and error honest", () => {
    expect(activityFrom({ kind: "not_live" })).toMatchObject({ status: "notlive", data: null });
    expect(activityFrom({ kind: "error" })).toMatchObject({ status: "error", data: null });
    expect(activityFrom({ kind: "ok", stats })).toMatchObject({ status: "live", updatedAt: stats.asOf });
  });
});

describe("judges trades from the worker", () => {
  it("reads distinct board bots, newest trade first, owner-signed flag kept", () => {
    expect(boardBotIds(boards)).toEqual(["7", "8", "9"]);
    const older = samplePage();
    older.bot.id = "8";
    older.trades = older.trades.map(t => ({ ...t, slot_time: "2026-11-25T03:30:00.000Z", owner_signed: true, tx_hash: `0x${"cd".repeat(32)}` }));
    const rows = tradesFromPages([older, samplePage()]);
    expect(rows.map(r => r.botId)).toEqual([7, 8]);
    expect(rows[0]).toMatchObject({ inrDisplay: 10000, userSigned: false, bot: { name: "AlphaWolf" } });
    expect(rows[1]!.userSigned).toBe(true);
  });
  it("labels each trade price with its age at the call, as the bot page does (SPEC §5.7, #89)", () => {
    const page = samplePage();
    expect(tradesFromPages([page])[0]!.age).toBe("2m old at the call");
    page.trades[0]!.oracle_updated_at = null;
    expect(tradesFromPages([page])[0]!.age).toBeNull();
  });
  it("uses labelled EXAMPLE data only when no worker is configured", async () => {
    expect((await judgesTrades(null)).status).toBe("example");
  });
  it("is live from the worker, and an error (not example) when it fails", async () => {
    const page = vi.fn(async (id: string) => (id === "7" ? { kind: "ok" as const, page: samplePage() } : { kind: "not_found" as const }));
    const ok = await judgesTrades("https://w", async () => boards, page);
    expect(ok.status).toBe("live");
    expect(ok.data).toHaveLength(1);
    const bad = await judgesTrades("https://w", async () => { throw new Error("down"); }, page, async () => null);
    expect(bad).toMatchObject({ status: "error", data: null });
    const busy = await judgesTrades("https://w", async () => boards, async () => ({ kind: "busy" as const }));
    expect(busy.status).toBe("error");
  });
  it("reads real bot ids from GET /bots while the board 404s (S0 hidden, #371)", async () => {
    const page = vi.fn(async (id: string) => (id === "7" ? { kind: "ok" as const, page: samplePage() } : { kind: "not_found" as const }));
    const listed = [bot("9", false), bot("7", true), bot("8", false)];
    const ok = await judgesTrades("https://w", async () => { throw new Error("404"); }, page, async () => listed);
    expect(ok).toMatchObject({ status: "live" });
    expect(ok.data).toHaveLength(1);
    expect(page.mock.calls.map(c => c[0])).toEqual(["7", "9", "8"]);
    expect(listedBotIds(listed, 2)).toEqual(["7", "9"]);
  });
});
