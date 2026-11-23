import type { PGlite } from "@electric-sql/pglite";
import type { Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "../../src/scheduler/db";
import { CHALLENGE_STATUS, challengeWinner, settleChallenges, type ChallengeChain, type OnChainChallenge } from "../../src/season/challenges";
import { testDb } from "../decisions/helpers";

const standing = (returnBps: number, maxDdBps: number) => ({ returnBps, maxDdBps });

describe("challengeWinner (SPEC §4.8)", () => {
  it("higher return wins, then lower drawdown", () => {
    expect(challengeWinner(7n, 8n, new Map([[7n, standing(500, 900)], [8n, standing(-100, 0)]]))).toBe(7n);
    expect(challengeWinner(7n, 8n, new Map([[7n, standing(-100, 0)], [8n, standing(500, 900)]]))).toBe(8n);
    expect(challengeWinner(7n, 8n, new Map([[7n, standing(200, 900)], [8n, standing(200, 300)]]))).toBe(8n);
  });

  it("an exact tie goes to the bot created first", () => {
    expect(challengeWinner(8n, 7n, new Map([[7n, standing(200, 300)], [8n, standing(200, 300)]]))).toBe(7n);
    expect(challengeWinner(7n, 8n, new Map())).toBe(7n);
  });

  it("a bot without a result loses", () => {
    expect(challengeWinner(7n, 8n, new Map([[8n, standing(-5000, 9000)]]))).toBe(8n);
    expect(challengeWinner(7n, 8n, new Map([[7n, standing(-5000, 9000)]]))).toBe(7n);
  });
});

describe("settleChallenges", () => {
  let pg: PGlite;
  let db: Queryable;
  const code = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

  beforeEach(async () => {
    ({ pg, db } = await testDb()); // bots 7 and 8
    await pg.exec(`
      insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades, status)
      values (1, '2026-11-25T18:30:00Z', '2026-11-27T16:00:00Z', 'sprint', 8, 'closed'),
             (2, '2026-11-27T18:30:00Z', '2026-11-29T16:00:00Z', 'sprint', 8, 'open');
      insert into season_results (season_id, bot_id, start_value_e8, end_value_e8, return_bps, max_dd_bps, trades)
      values (1, 7, 1, 1, -300, 500, 3), (1, 8, 1, 1, 250, 800, 4);
      insert into challenges (code, season_id, challenger_bot, opponent_bot, status) values
        ('${code(1)}', 1, 7, 8, 'accepted'),
        ('${code(2)}', 1, 7, null, 'open'),
        ('${code(3)}', 1, 8, null, 'open'),   -- accepted on-chain, not yet indexed
        ('${code(4)}', 1, 7, 8, 'accepted'),  -- our settle went out, not yet indexed
        ('${code(5)}', 1, 8, 7, 'settled'),
        ('${code(6)}', 2, 7, 8, 'accepted');  -- next season: not now`);
  }, 30_000);
  afterEach(() => pg.close());

  it("settles accepted ones for the winner, expires open ones, and goes by the chain's state", async () => {
    const onChain = new Map<Hex, OnChainChallenge>([
      [code(1), { challengerBot: 7n, opponentBot: 8n, status: CHALLENGE_STATUS.ACCEPTED }],
      [code(2), { challengerBot: 7n, opponentBot: 0n, status: CHALLENGE_STATUS.OPEN }],
      [code(3), { challengerBot: 8n, opponentBot: 7n, status: CHALLENGE_STATUS.ACCEPTED }],
      [code(4), { challengerBot: 7n, opponentBot: 8n, status: CHALLENGE_STATUS.SETTLED }],
    ]);
    const sent: string[] = [];
    const chain: ChallengeChain = {
      challenge: async (c) => onChain.get(c) ?? { challengerBot: 0n, opponentBot: 0n, status: CHALLENGE_STATUS.NONE },
      settleChallenge: async (c, winner) => void sent.push(`settle ${c.slice(-1)} ${winner}`),
      expireChallenge: async (c) => void sent.push(`expire ${c.slice(-1)}`),
    };

    expect(await settleChallenges({ db, chain, log: { info() {}, warn() {} } }, 1)).toBe(3);
    expect(sent).toEqual(["settle 1 8", "expire 2", "settle 3 8"]);
  });

  it("does nothing for a season without pending challenges", async () => {
    const chain: ChallengeChain = {
      challenge: async () => {
        throw new Error("no reads expected");
      },
      settleChallenge: async () => {},
      expireChallenge: async () => {},
    };
    await pg.exec("delete from challenges");
    expect(await settleChallenges({ db, chain, log: { info() {}, warn() {} } }, 1)).toBe(0);
  });
});
