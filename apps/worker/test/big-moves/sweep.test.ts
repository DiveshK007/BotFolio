import { describe, expect, it, vi } from "vitest";
import { STALE_GIVE_UP_SECONDS, sweepBigMoves } from "../../src/big-moves/sweep";
import type { RunnerDeps } from "../../src/slot/deps";
import type { RunnerChain } from "../../src/slot/chain";

// The paths the fork test can't reach cheaply: stale prices and giving up.
function deps(opts: { fresh: boolean; chainNow: number; deadline: number; seasonEnded?: boolean }) {
  const updates: unknown[][] = [];
  const db = {
    async query<Row extends object>(sql: string, params: unknown[] = []) {
      if (sql.includes("from big_moves where status = 'pending'")) {
        return {
          rows: [
            { id: "1", decision: "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab", bot_id: "7", asset: "SOL", side: "BUY", bps: 4500, action_index: 0, order_id: `0x${"ab".repeat(32)}`, deadline: String(opts.deadline), season_ended: opts.seasonEnded ?? false },
          ] as unknown as Row[],
        };
      }
      if (sql.startsWith("update big_moves")) updates.push(params);
      return { rows: [] as Row[] };
    },
  };
  const chain: Partial<RunnerChain> = {
    chainSeconds: async () => opts.chainNow,
    orderUsed: async () => false,
    executeBatch: vi.fn(async () => "0x" as const),
    state: async () => ({
      bot: { active: true, house: false, maxPerCoinBps: 5000, maxTradesPerDay: 8 } as never,
      portfolio: { cashE8: 100_000_000_000n, unitsE18: { BTC: 0n, ETH: 0n, SOL: 0n, XRP: 0n, GOLD: 0n } },
      tradesToday: 0,
    }),
  };
  const readings = ["BTC", "ETH", "SOL", "XRP", "GOLD"].map((asset) => ({
    asset, feed: "0x0", roundId: "1", priceE8: "7000000000", updatedAt: opts.chainNow, ageSeconds: 0, maxAgeSeconds: 1800, valid: true, fresh: asset !== "SOL" || opts.fresh,
  }));
  const d = {
    db,
    chain,
    readPrices: async () => readings,
    bigMove: { buyWeightBps: 3000, sellBps: 5000, ttlMs: 7_200_000 },
    log: { info() {}, warn() {} },
    now: () => new Date(opts.chainNow * 1000),
  } as unknown as RunnerDeps;
  return { d, updates, chain };
}

describe("sweepBigMoves when the price is too old", () => {
  it("leaves it pending for the next sweeps", async () => {
    const { d, updates, chain } = deps({ fresh: false, chainNow: 10_000, deadline: 9_000 });
    expect(await sweepBigMoves(d, new AbortController().signal)).toEqual({ shrunk: 0, expired: 0 });
    expect(updates).toEqual([]);
    expect(chain.executeBatch).not.toHaveBeenCalled();
  });

  it("gives up and holds after the retry window", async () => {
    const { d, updates } = deps({ fresh: false, chainNow: 9_000 + STALE_GIVE_UP_SECONDS + 1, deadline: 9_000 });
    expect(await sweepBigMoves(d, new AbortController().signal)).toEqual({ shrunk: 0, expired: 1 });
    expect(updates).toEqual([["1", "expired"]]);
  });
});

describe("sweepBigMoves after its season ended (#355)", () => {
  it("expires it without a shrink or a trade: the season's replay root is committed", async () => {
    const { d, updates, chain } = deps({ fresh: true, chainNow: 10_000, deadline: 9_000, seasonEnded: true });
    expect(await sweepBigMoves(d, new AbortController().signal)).toEqual({ shrunk: 0, expired: 1 });
    expect(updates).toEqual([["1", "expired"]]);
    expect(chain.executeBatch).not.toHaveBeenCalled();
  });
});
