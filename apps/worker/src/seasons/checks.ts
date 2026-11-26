import { InternalFailure } from "../auth/log";
import type { Queryable } from "../scheduler/db";
import type { Log } from "../scheduler/log";
import type { SeasonChain } from "./ledger";

export interface SeasonCheck {
  db: Queryable;
  chain: SeasonChain;
  /** The time to judge by: the later of the cron time and the clock. */
  now: Date;
  signal: AbortSignal;
  log: Log;
}

/**
 * 00:00 IST check (SPEC §6.1): opens every season whose `starts_at` has arrived, in order.
 *
 * The chain decides what is already open, so a rerun, a restart or a late deploy can't open one twice. A season
 * whose end has also passed is still opened: the contract numbers seasons in order, so the next needs it.
 * The contract opens S(n+1) only once S(n) is closed (#219 item 3), so a late deploy catches up one season per close.
 * Nothing here knows about sprint or weekly: both are just rows in `seasons` (#55).
 */
export async function openDueSeasons({ db, chain, now, signal, log }: SeasonCheck): Promise<number[]> {
  const opened: number[] = [];
  let next = await chain.nextSeason();

  while (!signal.aborted) {
    const { rows } = await db.query<{ starts_at: Date; ends_at: Date }>(
      "select starts_at, ends_at from seasons where id = $1::int",
      [next],
    );
    const season = rows[0];
    if (!season) throw new InternalFailure("season_row_missing"); // run packages/db/seeds/seasons.sql

    const startsAt = new Date(season.starts_at);
    if (startsAt > now) break;
    if (next > 0 && !(await chain.isClosed(next - 1))) {
      // openSeason would revert with PreviousSeasonOpen. The next run tries again after the close.
      log.warn("seasons.previous_not_closed", { season: next });
      break;
    }

    await chain.openSeason(next, startsAt, new Date(season.ends_at));
    opened.push(next);
    log.info("seasons.opened", { season: next });

    const after = await chain.nextSeason();
    // A lagging RPC would otherwise have us send the same open again. The next run carries on.
    if (after <= next) break;
    next = after;
  }
  return opened;
}

/**
 * 21:30 IST check (SPEC §6.1): an open season whose end has passed becomes `closing`.
 *
 * `closing` is the hand-over to #56, which computes the results and the data root and sends `closeSeason`.
 * Only the indexed SeasonClosed event makes a season `closed`.
 */
export async function markSeasonsClosing({ db, chain, now, log }: SeasonCheck): Promise<number[]> {
  const openedOnChain = await chain.nextSeason();
  const { rows } = await db.query<{ id: number }>(
    `update seasons set status = 'closing'
     where status = 'open' and ends_at <= $1::timestamptz and id < $2::int
     returning id`,
    [now.toISOString(), openedOnChain],
  );
  const ids = rows.map((row) => row.id).sort((a, b) => a - b);
  for (const season of ids) log.info("seasons.closing", { season });
  return ids;
}
