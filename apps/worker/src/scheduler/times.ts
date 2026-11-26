import { istDay } from "@botfolio/shared";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** 09:00, 13:00, 17:00 and 21:00 IST, as minutes after 00:00 UTC. */
const SLOT_MINUTES_UTC = [3, 7, 11, 15].map((hour) => hour * 60 + 30);
const RETRY_EVERY_MS = 5 * MINUTE_MS;
/** +5, +10, +15 min (SPEC §5 rule 4). */
const LAST_ATTEMPT = 3;
/** A slot runs from its time to just before this much later (the last retry starts at +15 min). */
export const SLOT_WINDOW_MS = (LAST_ATTEMPT + 1) * RETRY_EVERY_MS;

export interface SlotMoment {
  /** The slot's scheduled time, also on a retry. */
  time: Date;
  /** 0 at the slot, 1 to 3 for the stale retries. */
  attempt: number;
}

/**
 * The slot `now` belongs to, or null outside every slot's window (slot time to just before +20 min).
 * Later than that nothing runs: a decision for an old slot would trade on prices that slot never had.
 */
export function slotAt(now: Date): SlotMoment | null {
  const midnightUtc = now.getTime() - (now.getTime() % DAY_MS);
  for (const minutes of SLOT_MINUTES_UTC) {
    const time = midnightUtc + minutes * MINUTE_MS;
    const attempt = Math.floor((now.getTime() - time) / RETRY_EVERY_MS);
    if (attempt >= 0 && attempt <= LAST_ATTEMPT) return { time: new Date(time), attempt };
  }
  return null;
}

/** The last slot time at or before `at`. */
export function lastSlotTime(at: Date): Date {
  const midnightUtc = at.getTime() - (at.getTime() % DAY_MS);
  const today = SLOT_MINUTES_UTC.map((minutes) => midnightUtc + minutes * MINUTE_MS).filter((time) => time <= at.getTime());
  return new Date(today.at(-1) ?? midnightUtc - DAY_MS + SLOT_MINUTES_UTC.at(-1)! * MINUTE_MS);
}

/** The IST day a settle run is for: from 21:00 that day, earlier the day before (the next-09:00 retry). */
export function settleDayFor(scheduledFor: Date): number {
  return istDay(Math.floor(scheduledFor.getTime() / 1000) - 21 * 3600);
}
