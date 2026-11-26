import { isAddress, zeroAddress, type PublicClient } from "viem";
import { secret, type Env } from "../auth/env";
import type { Db } from "../scheduler/db";
import { errorLabel, type Log } from "../scheduler/log";
import type { JobSet } from "../scheduler/scheduler";
import { systemAccount } from "../system/key";
import { createSystemSender, type SystemSender } from "../system/sender";
import { markSeasonsClosing, openDueSeasons } from "./checks";
import { closeSeasons } from "../season/close";
import { supabaseStore } from "../season/storage";
import { TARGET_ABIS } from "../relay/abis";
import type { Abi, Address } from "viem";
import { createChallengeChain } from "../season/challenges";
import { createTrustRegistryChain } from "../trust/registry";
import { proposeVersions, type V2Deps } from "../v2/job";
import { createSeasonChain } from "./ledger";

interface SeasonJobsOptions {
  db: Db;
  env: Env;
  client: PublicClient;
  rpcUrls: readonly string[];
  log: Log;
  /** The committer wallet's shared sender. Defaults to one of its own. */
  committer?: SystemSender | null;
  /** v2 proposals after each close (#57). Without an LLM they come from the deterministic fallback. */
  v2?: Pick<V2Deps, "llm" | "llmConfig" | "resting">;
  now?: () => Date;
}

// 3 tries 5 min apart end before the next 15-min season_close cron, which would otherwise find the lock held.
const CLOSE_ATTEMPTS = 3;
const CLOSE_RETRY_MS = 5 * 60_000;

/** The two §6.1 season checks, or why they can't run (variable names only, never values). */
export function seasonJobs({ db, env, client, rpcUrls, log, committer, v2, now = () => new Date() }: SeasonJobsOptions): JobSet {
  const missing: string[] = [];
  const address = env.SEASON_LEDGER_ADDRESS?.trim().toLowerCase() ?? "";
  if (!isAddress(address) || address === zeroAddress) missing.push("SEASON_LEDGER_ADDRESS");
  const account = systemAccount(env, "COMMITTER_PRIVATE_KEY");
  if (!account) missing.push("COMMITTER_PRIVATE_KEY");
  if (!isAddress(address) || !account || missing.length > 0) {
    const why = `needs ${missing.join(", ")}`;
    return { handlers: {}, unavailable: { season_open: why, season_close: why } };
  }

  // What closing needs beyond the checks: storage for the replay file, and where the file says to check it.
  const closingMissing: string[] = [];
  const ledger = env.PAPER_LEDGER_ADDRESS?.trim().toLowerCase() ?? "";
  if (!isAddress(ledger) || ledger === zeroAddress) closingMissing.push("PAPER_LEDGER_ADDRESS");
  const fromBlock = env.INDEXER_START_BLOCK?.trim() ?? "";
  if (!/^\d+$/.test(fromBlock)) closingMissing.push("INDEXER_START_BLOCK");
  const trustRegistry = env.TRUST_REGISTRY_ADDRESS?.trim().toLowerCase() ?? "";
  if (!isAddress(trustRegistry) || trustRegistry === zeroAddress) closingMissing.push("TRUST_REGISTRY_ADDRESS");
  const challengesAddress = env.CHALLENGES_ADDRESS?.trim().toLowerCase() ?? "";
  if (!isAddress(challengesAddress) || challengesAddress === zeroAddress) closingMissing.push("CHALLENGES_ADDRESS");
  const supabaseUrl = env.SUPABASE_URL?.trim() ?? "";
  if (!/^https:\/\//.test(supabaseUrl)) closingMissing.push("SUPABASE_URL");
  const serviceKey = secret(env, "SUPABASE_SERVICE_ROLE_KEY", 20);
  if (!serviceKey) closingMissing.push("SUPABASE_SERVICE_ROLE_KEY");

  const sender = committer ?? createSystemSender({ rpcUrls, account });
  const chain = createSeasonChain({ client, address, sender });
  const trust = createTrustRegistryChain({ client, address: trustRegistry as Address, sender });
  const challenges = createChallengeChain({ client, address: challengesAddress as Address, sender });
  const closing =
    closingMissing.length === 0 && serviceKey
      ? {
          chain: {
            isClosed: (n: number) => chain.isClosed(n),
            closeSeason: (n: number, root: `0x${string}`, uri: string) => chain.closeSeason(n, root, uri),
            startCashE8: async () =>
              (await client.readContract({ address: ledger as Address, abi: TARGET_ABIS.PaperLedger as Abi, functionName: "START_CASH_E8" })) as bigint,
            orderUsed: async (orderId: `0x${string}`) =>
              (await client.readContract({ address: ledger as Address, abi: TARGET_ABIS.PaperLedger as Abi, functionName: "usedOrder", args: [orderId] })) as boolean,
            scoresRoot: (n: number) => trust.scoresRoot(n),
            rulesPublished: (version: `0x${string}`) => trust.rulesPublished(version),
            commitScores: (n: number, version: `0x${string}`, root: `0x${string}`, uri: string) => trust.commitScores(n, version, root, uri),
            challenge: (code: `0x${string}`) => challenges.challenge(code),
            settleChallenge: (code: `0x${string}`, winner: bigint) => challenges.settleChallenge(code, winner),
            expireChallenge: (code: `0x${string}`) => challenges.expireChallenge(code),
          },
          store: supabaseStore({ url: supabaseUrl, serviceKey, bucket: env.REPLAY_BUCKET?.trim() || "replay" }),
          contracts: { chainId: 1990, seasonLedger: address, paperLedger: ledger as Address, fromBlock },
        }
      : null;

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
        let closeError: unknown = null;
        if (!closing) {
          log.warn("season.close_not_configured", { needs: closingMissing });
          // Fail the run, so /healthz and the job-failure alert show it: a "successful" close that never closes leaves the next season unopened.
          closeError = new Error(`season close needs ${closingMissing.join(", ")}`);
        } else {
          // The last batch's trades need the indexer (10 s loop, 2 confirmations): retry a few times before giving up.
          for (let attempt = 1; ; attempt++) {
            try {
              await closeSeasons({ ...closing, db, log, now }, signal);
              break;
            } catch (error) {
              if (attempt >= CLOSE_ATTEMPTS || signal.aborted) {
                closeError = error;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, CLOSE_RETRY_MS));
            }
          }
          if (!closeError) {
            // A late close (a retry, a restart racing season_open) mustn't leave the next season waiting for the
            // next open check. It never opens early: openDueSeasons checks starts_at and the chain.
            await db
              .withLock("job:season_open", () => openDueSeasons({ db, chain, now: at(scheduledFor), signal, log }))
              .catch((error: unknown) => log.warn("seasons.open_after_close_failed", { error: errorLabel(error) }));
          }
        }
        try {
          // From the results the close saved, even while its on-chain step is still failing.
          if (v2) await proposeVersions({ ...v2, db, log, now }, signal);
        } finally {
          if (closeError) throw closeError;
        }
      },
    },
  };
}
