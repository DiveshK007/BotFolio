import type { Abi, Address, Hex, PublicClient } from "viem";
import { TARGET_ABIS } from "../relay/abis";
import type { Queryable } from "../scheduler/db";
import type { Log } from "../scheduler/log";
import type { SystemSender } from "../system/sender";

/** `IChallenges.Status`. */
export const CHALLENGE_STATUS = { NONE: 0, OPEN: 1, ACCEPTED: 2, SETTLED: 3, EXPIRED: 4 } as const;

export interface OnChainChallenge {
  challengerBot: bigint;
  opponentBot: bigint;
  status: number;
}

export interface ChallengeChain {
  challenge(code: Hex): Promise<OnChainChallenge>;
  /** COMMITTER_ROLE. Reverts unless the season is closed on-chain and the challenge accepted. */
  settleChallenge(code: Hex, winnerBot: bigint): Promise<void>;
  /** Anyone may call it once the season is closed, for a challenge nobody accepted. It frees the challenger's slot. */
  expireChallenge(code: Hex): Promise<void>;
}

export function createChallengeChain(opts: { client: PublicClient; address: Address; sender: SystemSender }): ChallengeChain {
  const { client, address, sender } = opts;
  const abi: Abi = TARGET_ABIS.Challenges;
  return {
    async challenge(code) {
      const [challengerBot, opponentBot, , status] = (await client.readContract({ address, abi, functionName: "challenges", args: [code] })) as readonly [bigint, bigint, number, number];
      return { challengerBot, opponentBot, status: Number(status) };
    },
    async settleChallenge(code, winnerBot) {
      await sender.write({ address, abi, functionName: "settle", args: [code, winnerBot] });
    },
    async expireChallenge(code) {
      await sender.write({ address, abi, functionName: "expire", args: [code] });
    },
  };
}

export interface SeasonStanding {
  returnBps: number;
  maxDdBps: number;
}

/**
 * The winner of a challenge (SPEC §2.5, §4.8): the higher season return, then the lower max drawdown, the same
 * order as the battle and Top Returns. On an exact tie, the bot created first (lower botId), as Most Trusted breaks
 * ties. A bot without a season result loses to one with a result.
 *
 * Anyone can recompute it from the public `season_results` (`site_season_results`).
 */
export function challengeWinner(challenger: bigint, opponent: bigint, standings: ReadonlyMap<bigint, SeasonStanding>): bigint {
  const a = standings.get(challenger);
  const b = standings.get(opponent);
  const first = challenger < opponent ? challenger : opponent;
  if (!a && !b) return first;
  if (!a) return opponent;
  if (!b) return challenger;
  if (a.returnBps !== b.returnBps) return a.returnBps > b.returnBps ? challenger : opponent;
  if (a.maxDdBps !== b.maxDdBps) return a.maxDdBps < b.maxDdBps ? challenger : opponent;
  return first;
}

/**
 * Settles each accepted challenge of a season closed on-chain, and expires each open one. The chain's state
 * decides, not the row: the indexer may not have seen an accept, or our own settle, yet. Run after
 * `saveSeasonResults`.
 */
export async function settleChallenges(deps: { db: Queryable; chain: ChallengeChain; log: Log }, season: number): Promise<number> {
  const { db, chain, log } = deps;
  const { rows } = await db.query<{ code: Hex }>(
    "select code from challenges where season_id = $1::int and status in ('open', 'accepted') order by code",
    [season],
  );
  if (rows.length === 0) return 0;

  const { rows: results } = await db.query<{ bot_id: string; return_bps: number; max_dd_bps: number }>(
    "select bot_id::text as bot_id, return_bps, max_dd_bps from season_results where season_id = $1::int",
    [season],
  );
  const standings = new Map(results.map((r) => [BigInt(r.bot_id), { returnBps: r.return_bps, maxDdBps: r.max_dd_bps }]));

  let sent = 0;
  for (const { code } of rows) {
    const c = await chain.challenge(code);
    if (c.status === CHALLENGE_STATUS.OPEN) {
      await chain.expireChallenge(code);
      log.info("challenge.expired", { season, code });
      sent++;
    } else if (c.status === CHALLENGE_STATUS.ACCEPTED) {
      const winner = challengeWinner(c.challengerBot, c.opponentBot, standings);
      await chain.settleChallenge(code, winner);
      log.info("challenge.settled", { season, code, winner: winner.toString() });
      sent++;
    } else if (c.status === CHALLENGE_STATUS.NONE) {
      log.warn("challenge.not_on_chain", { season, code });
    }
    // SETTLED or EXPIRED: done already; the indexer catches up.
  }
  return sent;
}
