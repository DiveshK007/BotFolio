import { isAddress, zeroAddress, type PublicClient } from "viem";
import type { Env } from "../auth/env";
import type { Db } from "../scheduler/db";
import type { Log } from "../scheduler/log";
import type { JobSet } from "../scheduler/scheduler";
import { systemAccount } from "../system/key";
import { createSystemSender } from "../system/sender";
import { markSeasonsClosing, openDueSeasons } from "./checks";
import { createSeasonChain } from "./ledger";

interface SeasonJobsOptions {
  db: Db;
  env: Env;
  client: PublicClient;
  rpcUrls: readonly string[];
  log: Log;
  now?: () => Date;
}

/** The two §6.1 season checks, or why they can't run (variable names only, never values). */
export function seasonJobs({ db, env, client, rpcUrls, log, now = () => new Date() }: SeasonJobsOptions): JobSet {
  const missing: string[] = [];
  const address = env.SEASON_LEDGER_ADDRESS?.trim().toLowerCase() ?? "";
  if (!isAddress(address) || address === zeroAddress) missing.push("SEASON_LEDGER_ADDRESS");
  const account = systemAccount(env, "COMMITTER_PRIVATE_KEY");
  if (!account) missing.push("COMMITTER_PRIVATE_KEY");
  if (!isAddress(address) || !account || missing.length > 0) {
    const why = `needs ${missing.join(", ")}`;
    return { handlers: {}, unavailable: { season_open: why, season_close: why } };
  }

  const chain = createSeasonChain({ client, address, sender: createSystemSender({ rpcUrls, account }) });
  // A cron can fire a few ms before its minute, and a boundary is exactly on the minute.
  const at = (scheduledFor: Date) => new Date(Math.max(scheduledFor.getTime(), now().getTime()));

  return {
    unavailable: {},
    handlers: {
      season_open: async ({ scheduledFor, signal }) => {
        await openDueSeasons({ db, chain, now: at(scheduledFor), signal, log });
      },
      season_close: async ({ scheduledFor, signal }) => {
        await markSeasonsClosing({ db, chain, now: at(scheduledFor), signal, log });
      },
    },
  };
}
