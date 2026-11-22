import type { OracleReading } from "../oracle";
import type { Queryable } from "../scheduler/db";
import type { Log } from "../scheduler/log";
import { settleDayFor } from "../scheduler/times";

/** About 41k + 11k per bot (docs/gas.md). */
export const SETTLE_BATCH = 100;
/** DailyCall.SETTLE_FROM: 21:00 IST. */
const SETTLE_FROM_SECONDS = 75_600;
const IST_OFFSET_SECONDS = 19_800;

export interface DailyCallChain {
  settled(botId: bigint, day: number): Promise<boolean>;
  settle(botIds: readonly bigint[], day: number): Promise<void>;
}

export interface SettleRun {
  db: Queryable;
  chain: DailyCallChain;
  readBtc(nowSeconds: number): Promise<OracleReading>;
  scheduledFor: Date;
  now: Date;
  signal: AbortSignal;
  log: Log;
}

/**
 * 21:00, every 10 min until 23:50, then the next 09:00 (SPEC §4.7, §6.1).
 *
 * The contract skips quietly without a fresh BTC round from 21:00 or later, so that is checked here first: a
 * skip would still cost gas, 19 times a night. What is settled comes from the chain, because the indexer's
 * `settle_tx` lags it. The indexer writes the results.
 */
export async function settleDailyCalls(run: SettleRun): Promise<number> {
  const { db, chain, readBtc, scheduledFor, now, signal, log } = run;
  const day = settleDayFor(scheduledFor);

  const { rows } = await db.query<{ id: string }>(
    `select bot_id::text as id from daily_calls
     where day = $1::int and call_tx is not null and settle_tx is null
     order by bot_id`,
    [day],
  );
  if (rows.length === 0) return 0;

  const btc = await readBtc(Math.floor(now.getTime() / 1000));
  if (!btc.fresh || btc.updatedAt < day * 86_400 - IST_OFFSET_SECONDS + SETTLE_FROM_SECONDS) {
    log.info("daily_call.settles_late", { day, waiting: rows.length });
    return 0;
  }

  const due: bigint[] = [];
  for (const { id } of rows) if (!(await chain.settled(BigInt(id), day))) due.push(BigInt(id));

  let sent = 0;
  for (let i = 0; i < due.length && !signal.aborted; i += SETTLE_BATCH) {
    const batch = due.slice(i, i + SETTLE_BATCH);
    await chain.settle(batch, day);
    sent += batch.length;
    log.info("daily_call.settled", { day, bots: batch.length, round: btc.roundId });
  }
  return sent;
}
