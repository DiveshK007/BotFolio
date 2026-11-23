import { isAddress, zeroAddress, type Abi, type Address, type PublicClient } from "viem";
import { InternalFailure } from "../auth/log";
import type { Env } from "../auth/env";
import type { FeedConfig } from "../config";
import { readFeed } from "../oracle";
import { TARGET_ABIS } from "../relay/abis";
import type { Db } from "../scheduler/db";
import type { Log } from "../scheduler/log";
import type { JobSet } from "../scheduler/scheduler";
import { systemAccount } from "../system/key";
import { createSystemSender, type SystemSender } from "../system/sender";
import { settleDailyCalls, type DailyCallChain } from "./settle";

export function createDailyCallChain(opts: { client: PublicClient; address: Address; sender: SystemSender }): DailyCallChain {
  const { client, address, sender } = opts;
  const abi: Abi = TARGET_ABIS.DailyCall;
  return {
    async settled(botId, day) {
      const call = (await client.readContract({ address, abi, functionName: "calls", args: [botId, day] })) as readonly unknown[];
      return call[5] === true; // settled
    },
    async settle(botIds, day) {
      await sender.write({ address, abi, functionName: "settle", args: [botIds, day] });
    },
  };
}

interface DailyCallJobsOptions {
  db: Db;
  env: Env;
  client: PublicClient;
  feeds: readonly FeedConfig[];
  log: Log;
  /** The committer wallet's one sender, shared with the season jobs so they can't take the same nonce. */
  committer: SystemSender | null;
  now?: () => Date;
}

export function dailyCallJobs({ db, env, client, feeds, log, committer, now = () => new Date() }: DailyCallJobsOptions): JobSet {
  const missing: string[] = [];
  const address = env.DAILY_CALL_ADDRESS?.trim().toLowerCase() ?? "";
  if (!isAddress(address) || address === zeroAddress) missing.push("DAILY_CALL_ADDRESS");
  if (!committer) missing.push("COMMITTER_PRIVATE_KEY");
  const btc = feeds.find((feed) => feed.asset === "BTC");
  if (!btc) throw new InternalFailure("no_btc_feed");
  if (!isAddress(address) || !committer || missing.length > 0) {
    return { handlers: {}, unavailable: { daily_call_settle: `needs ${missing.join(", ")}` } };
  }

  const chain = createDailyCallChain({ client, address, sender: committer });
  return {
    unavailable: {},
    handlers: {
      daily_call_settle: async ({ scheduledFor, signal }) => {
        const readBtc = (nowSeconds: number) => readFeed(client, btc, nowSeconds);
        await settleDailyCalls({ db, chain, readBtc, scheduledFor, now: now(), signal, log });
      },
    },
  };
}

export function committerSender(env: Env, rpcUrls: readonly string[]): SystemSender | null {
  const account = systemAccount(env, "COMMITTER_PRIVATE_KEY");
  return account ? createSystemSender({ rpcUrls, account }) : null;
}
