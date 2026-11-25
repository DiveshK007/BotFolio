import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLeaderboards, formatBps, formatSortino, parseLeaderboards, parseSeasonParam, winRate } from "./leaderboards";

const base = "https://worker.example";
const entry = { botId: "7", name: "AlphaWolf", emoji: "🐺", isHouse: false, ownerQieName: "alice.qie", rank: 1 };
const house = { ...entry, botId: "90", name: "Steady Sam", isHouse: true, ownerQieName: null, rank: null };
const body = {
  ok: true,
  currentSeason: 2,
  leaderboards: {
    season: 2,
    live: true,
    trustSeason: 1,
    topReturns: [{ ...house, returnBps: 300, maxDdBps: 50 }, { ...entry, returnBps: 120, maxDdBps: 400 }],
    bestRiskAdjusted: [{ ...entry, sortino: 1.25, returnBps: 120 }],
    mostTrusted: [{ ...entry, total: 81 }],
    coachVsBot: [{ ...entry, calls: 4, you: 3, bot: 2 }],
  },
};

const respond = (json: unknown, status = 200) => {
  const mock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(json), { status }));
  vi.stubGlobal("fetch", mock);
  return mock;
};

afterEach(() => vi.unstubAllGlobals());

describe("fetchLeaderboards", () => {
  it("asks for the current season without a number, and a given one with it", async () => {
    const mock = respond(body);
    const answer = await fetchLeaderboards(base, null);
    expect(answer.currentSeason).toBe(2);
    expect(answer.boards.topReturns[0]).toMatchObject({ name: "Steady Sam", rank: null });
    expect(mock.mock.calls[0]![0]).toBe("https://worker.example/leaderboards");
    expect(mock.mock.calls[0]![1]).toMatchObject({ credentials: "omit" });

    await fetchLeaderboards(base, 0);
    expect(mock.mock.calls[1]![0]).toBe("https://worker.example/leaderboards?season=0");
  });

  it("passes the worker's own words through on an error", async () => {
    respond({ ok: false, error: { code: "NOT_FOUND", message: "No such season." } }, 404);
    await expect(fetchLeaderboards(base, 9)).rejects.toMatchObject({ code: "NOT_FOUND", message: "No such season." });
    respond({ ok: false, error: { code: "LEADERBOARDS_DISABLED", message: "Leaderboards aren't switched on yet." } }, 503);
    await expect(fetchLeaderboards(base, null)).rejects.toMatchObject({ code: "LEADERBOARDS_DISABLED" });
  });

  it("fails cleanly on no answer or an off-shape one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("network"))));
    await expect(fetchLeaderboards(base, null)).rejects.toMatchObject({ code: "NO_ANSWER" });
    respond("<html>", 502);
    await expect(fetchLeaderboards(base, null)).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    respond({ ...body, currentSeason: undefined });
    await expect(fetchLeaderboards(base, null)).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });
});

describe("parseLeaderboards", () => {
  const boards = body.leaderboards;
  it("rejects entries that could break a link or a number", () => {
    expect(parseLeaderboards(body)).not.toBeNull();
    expect(parseLeaderboards({ ...body, leaderboards: { ...boards, mostTrusted: [{ ...entry, botId: "../x", total: 1 }] } })).toBeNull();
    expect(parseLeaderboards({ ...body, leaderboards: { ...boards, topReturns: [{ ...entry, returnBps: "12", maxDdBps: 0 }] } })).toBeNull();
    expect(parseLeaderboards({ ...body, leaderboards: { ...boards, coachVsBot: [{ ...entry, calls: 0, you: 0, bot: 0 }] } })).toBeNull();
    expect(parseLeaderboards({ ...body, leaderboards: { ...boards, bestRiskAdjusted: null } })).toBeNull();
  });
});

describe("display", () => {
  it("formats returns, drawdown, Sortino and win rate", () => {
    expect(formatBps(1234)).toBe("+12.34%");
    expect(formatBps(-50)).toBe("−0.50%");
    expect(formatBps(0)).toBe("0.00%");
    expect(formatBps(720, false)).toBe("7.20%");
    expect(formatSortino(1.256)).toBe("1.26");
    expect(formatSortino(-0.4)).toBe("−0.40");
    expect(winRate({ you: 3, calls: 4 })).toBe("75%");
    expect(winRate({ you: 2, calls: 3 })).toBe("67%");
  });

  it("reads ?season= only as a plain number", () => {
    expect(parseSeasonParam("3")).toBe(3);
    expect(parseSeasonParam("0")).toBe(0);
    for (const bad of [undefined, "", "03", "-1", "x", ["1", "2"]]) expect(parseSeasonParam(bad)).toBeNull();
  });
});
