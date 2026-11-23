import type { Queryable } from "../scheduler/db";
import type { Log } from "../scheduler/log";
import type { JobSet } from "../scheduler/scheduler";
import type { CardChain } from "./build";
import { makeRecaps } from "./recap";
import { sweepSlotCards } from "./slot-cards";

interface CardJobOptions {
  db: Queryable;
  log: Log;
  /** null without PAPER_LEDGER_ADDRESS (the ₹ rule needs START_CASH_E8). */
  chain: CardChain | null;
  now?: () => Date;
}

/** The SPEC §6.1 `recap` job (21:35 IST): the day's slot cards, then one recap per active raised bot. */
export function cardJobs({ db, log, chain, now = () => new Date() }: CardJobOptions): JobSet {
  if (!chain) return { handlers: {}, unavailable: { recap: "needs PAPER_LEDGER_ADDRESS" } };
  const deps = { db, chain, log, now };
  return {
    unavailable: {},
    handlers: {
      recap: async ({ signal }) => {
        await sweepSlotCards(deps);
        await makeRecaps(deps, signal);
      },
    },
  };
}

/**
 * First-trade and slot-loss cards shouldn't wait for 21:35: a newcomer shares their first trade within the minute.
 * A plain loop like the indexer's; overlapping runs are skipped. Returns stop().
 */
export function startCardSweeper(opts: { db: Queryable; chain: CardChain; log: Log; intervalMs?: number; now?: () => Date }): () => Promise<void> {
  const { db, chain, log, intervalMs = 60_000, now = () => new Date() } = opts;
  let running: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (running) return;
    running = sweepSlotCards({ db, chain, log, now })
      .then(() => undefined)
      .catch((error: unknown) => log.warn("cards.sweep_failed", { cause: error instanceof Error ? error.name : "error" }))
      .finally(() => {
        running = null;
      });
  }, intervalMs);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await running;
  };
}
