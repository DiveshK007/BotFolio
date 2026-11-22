import type { PublicClient } from "viem";
import type { AssetId } from "@botfolio/shared";
import type { FeedConfig } from "./config";

/** Chainlink AggregatorV3 `latestRoundData` — standard interface, not one of our contracts. */
export const aggregatorV3Abi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

export interface RoundData {
  roundId: bigint;
  answer: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
}

export interface OracleReading {
  asset: AssetId;
  feed: `0x${string}`;
  roundId: string;
  /** 8-decimal price (play USDT / USD). */
  priceE8: string;
  updatedAt: number;
  ageSeconds: number;
  maxAgeSeconds: number;
  valid: boolean;
  fresh: boolean;
  error?: string;
}

/** Above uint64 max the contracts treat a feed as broken (OracleReader.MAX_PRICE, PR #230). */
export const MAX_PRICE_E8 = 2n ** 64n - 1n;

/**
 * SPEC §5 rule 3, plus the two checks the contracts add (OracleReader): a timestamp in the future and a
 * price above MAX_PRICE_E8 are invalid. Off-chain read only — for the prompt, the UI and /healthz. The contracts re-read
 * the price at execution time; nothing here is ever passed into a trade.
 * `answeredInRound ≥ roundId` is skipped when the feed returns 0 there (UNVERIFIED feed behaviour).
 */
export function classifyRound(round: RoundData, nowSeconds: number, maxAgeSeconds: number) {
  const updatedAt = Number(round.updatedAt);
  const ageSeconds = Math.max(0, nowSeconds - updatedAt);
  const answeredOk = round.answeredInRound === 0n || round.answeredInRound >= round.roundId;
  const valid =
    round.answer > 0n && round.answer <= MAX_PRICE_E8 && round.updatedAt > 0n && updatedAt <= nowSeconds && answeredOk;
  return { valid, fresh: valid && ageSeconds <= maxAgeSeconds, ageSeconds, updatedAt };
}

export async function readFeed(client: PublicClient, feed: FeedConfig, nowSeconds: number): Promise<OracleReading> {
  try {
    const [roundId, answer, , updatedAt, answeredInRound] = await client.readContract({
      address: feed.address,
      abi: aggregatorV3Abi,
      functionName: "latestRoundData",
    });
    const c = classifyRound({ roundId, answer, updatedAt, answeredInRound }, nowSeconds, feed.maxAgeSeconds);
    return {
      asset: feed.asset,
      feed: feed.address,
      roundId: roundId.toString(),
      priceE8: answer.toString(),
      updatedAt: c.updatedAt,
      ageSeconds: c.ageSeconds,
      maxAgeSeconds: feed.maxAgeSeconds,
      valid: c.valid,
      fresh: c.fresh,
    };
  } catch (e) {
    return {
      asset: feed.asset,
      feed: feed.address,
      roundId: "0",
      priceE8: "0",
      updatedAt: 0,
      ageSeconds: 0,
      maxAgeSeconds: feed.maxAgeSeconds,
      valid: false,
      fresh: false,
      error: e instanceof Error ? e.message.split("\n")[0] : String(e),
    };
  }
}

export async function readAllFeeds(client: PublicClient, feeds: FeedConfig[], nowSeconds: number): Promise<OracleReading[]> {
  return Promise.all(feeds.map((f) => readFeed(client, f, nowSeconds)));
}
