import { refreshBudget } from "../budget/spend";
import { saveOracleReads } from "../decisions/record";
import { revealOutputHashes } from "../decisions/secrecy";
import { errorLabel } from "../scheduler/log";
import type { Slot } from "../scheduler/slots";
import { decideBot } from "./decide";
import { deliver } from "./deliver";
import type { RunnerDeps } from "./deps";
import { markPrices, saveMark } from "./marks";
import { priceChanges, pricesFrom, type Market } from "./market";
import { retryStale } from "./retry";
import { decisionsOfSlot } from "./stored";

/** SPEC §6.6: per-slot concurrency 10. */
export const SLOT_CONCURRENCY = 10;

export async function eachBot<T>(items: readonly T[], work: (item: T) => Promise<void>, limit = SLOT_CONCURRENCY) {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

export async function readMarket(deps: RunnerDeps, slot: Pick<Slot, "id"> | null): Promise<Market> {
  const now = deps.now();
  const readings = await deps.readPrices(Math.floor(now.getTime() / 1000));
  const prices = pricesFrom(readings);
  const changes = await priceChanges(deps.db, prices, now);
  if (slot) await saveOracleReads(deps.db, slot.id, readings);
  return { readings, prices, changes };
}

/**
 * A scheduled slot and its stale retries (SPEC §6.1). Run it as often as you like:
 *  - a bot that already has a decision for this slot is never decided, or charged for, again;
 *  - orders already executed are never sent again;
 *  - one bot's failure never stops the others.
 */
export async function runSlot(
  deps: RunnerDeps,
  run: { slot: Slot; attempt: number; signal: AbortSignal },
): Promise<{ failed: number }> {
  const { db, chain, log, health } = deps;
  const { slot, attempt, signal } = run;
  const failed = new Set<bigint>();
  const contained = (stage: string, work: (botId: bigint) => Promise<void>) => async (botId: bigint) => {
    try {
      await work(botId);
    } catch (error) {
      failed.add(botId);
      log.warn("runner.bot_failed", { stage, slotId: slot.id, botId, error: errorLabel(error) });
    }
  };

  const now = deps.now();
  await revealOutputHashes(db, now);
  await refreshBudget(db, health, log, now);
  const market = await readMarket(deps, slot);

  const { rows } = await db.query<{ id: string; status: string; decided: boolean }>(
    `select b.id::text as id, b.status::text as status,
            exists (select 1 from decisions d where d.bot_id = b.id and d.slot_id = $1::bigint) as decided
     from bots b where b.created_at <= $2::timestamptz order by b.id`,
    [slot.id, now.toISOString()],
  );

  // On a retry this also picks up a bot that failed at the slot.
  const undecided = rows.filter((row) => row.status === "active" && !row.decided).map((row) => BigInt(row.id));
  await eachBot(
    undecided,
    contained("decide", async (botId) => {
      if (!signal.aborted) await decideBot(deps, slot, botId, market);
    }),
  );

  if (attempt > 0) {
    const waiting = new Map((await decisionsOfSlot(db, slot.id)).map((d) => [d.botId, d]));
    await eachBot(
      [...waiting.keys()],
      contained("retry", async (botId) => {
        if (!signal.aborted) await retryStale(deps, slot, attempt, waiting.get(botId)!, market);
      }),
    );
  }

  // Decided is decided: it is sent even during a shutdown, and a rerun wouldn't send it twice.
  const { failedBots } = await deliver(deps, await decisionsOfSlot(db, slot.id), market);
  for (const botId of failedBots) failed.add(botId);

  const prices = await markPrices(db, market);
  await eachBot(
    rows.map((row) => BigInt(row.id)),
    contained("mark", async (botId) => {
      const { portfolio } = await chain.state(botId, Math.floor(now.getTime() / 1000));
      await saveMark(db, slot.id, botId, portfolio, prices);
    }),
  );

  return { failed: failed.size };
}
