import { describe, expect, it, vi } from "vitest";
import { fetchStats, parseStats } from "./stats";

const base = "https://worker.example";
const stats = {
  asOf: "2026-11-25T12:00:00.000Z",
  userSigned: {
    txs: 7,
    signers: 2,
    active7d: 1,
    active30d: 1,
    recurring: 1,
    byAction: {
      createBot: { txs: 2, wallets: 2 },
      approveV2: { txs: 0, wallets: 0 },
      correction: { txs: 1, wallets: 1 },
      bigMove: { txs: 1, wallets: 1 },
      dailyCall: { txs: 1, wallets: 1 },
      challengeCreate: { txs: 1, wallets: 1 },
      challengeAccept: { txs: 1, wallets: 1 },
    },
  },
  system: { txs: 6, byKind: { runnerTrades: 1, dailyCallSettles: 1, seasonCloses: 1, scoreCommits: 1, houseBots: 2 } },
};
const body = { ok: true, stats };
const respond = (json: unknown, status = 200) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(json), { status }));

describe("fetchStats", () => {
  it("reads GET /stats", async () => {
    const mock = respond(body);
    expect(await fetchStats(base, mock)).toEqual({ kind: "ok", stats });
    expect(mock.mock.calls[0]![0]).toBe("https://worker.example/stats");
  });

  it("not live without a worker URL or on 503; error otherwise", async () => {
    expect(await fetchStats(null, respond(body))).toEqual({ kind: "not_live" });
    expect(await fetchStats(base, respond({ ok: false }, 503))).toEqual({ kind: "not_live" });
    expect(await fetchStats(base, respond({ ok: false }, 500))).toEqual({ kind: "error" });
    expect(await fetchStats(base, vi.fn(async () => Promise.reject(new TypeError("network"))))).toEqual({ kind: "error" });
  });
});

describe("parseStats", () => {
  it("accepts the worker's shape", () => {
    expect(parseStats(body)).toEqual(stats);
  });

  it("rejects off-shape answers", () => {
    expect(parseStats(null)).toBeNull();
    expect(parseStats({ ok: false, stats })).toBeNull();
    expect(parseStats({ ok: true, stats: { ...stats, asOf: "soon" } })).toBeNull();
    expect(parseStats({ ok: true, stats: { ...stats, userSigned: { ...stats.userSigned, signers: -1 } } })).toBeNull();
    expect(parseStats({ ok: true, stats: { ...stats, userSigned: { ...stats.userSigned, txs: "7" } } })).toBeNull();
    const noCalls: Record<string, unknown> = { ...stats.userSigned.byAction };
    delete noCalls.dailyCall;
    expect(parseStats({ ok: true, stats: { ...stats, userSigned: { ...stats.userSigned, byAction: noCalls } } })).toBeNull();
    expect(parseStats({ ok: true, stats: { ...stats, system: { ...stats.system, byKind: {} } } })).toBeNull();
  });
});
