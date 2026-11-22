import { istDay } from "@botfolio/shared";
import { hashJson } from "../canonical";
import type { Queryable } from "../scheduler/db";
import { readExact } from "./json";

/** DailyCall.CALL_CUTOFF: 20:00 IST. */
const CALL_CUTOFF_SECONDS = 72_000;
const IST_OFFSET_SECONDS = 19_800;

/** When the Daily Call of `decidedAt`'s IST day closes. From then on nobody can still pick. */
export function callsCloseAt(decidedAt: Date): Date {
  const day = istDay(Math.floor(decidedAt.getTime() / 1000));
  return new Date((day * 86_400 - IST_OFFSET_SECONDS + CALL_CUTOFF_SECONDS) * 1000);
}

/**
 * Writes the `output_hash` values that were held back.
 *
 * `site_decisions` publishes the hash and it covers `daily_call`, so with the public reason and a guessed `why`
 * it gives the bot's answer away (SPEC §6.4.1). It waits until that day's calls close at 20:00 IST, which is
 * still before every season's 21:30 close, so the replay file always has it.
 */
export async function revealOutputHashes(db: Queryable, now: Date): Promise<number> {
  const { rows } = await db.query<{ id: string; raw: unknown; slot_time: Date }>(
    `select d.id::text as id, d.raw_output_json as raw, s.slot_time
     from decisions d join slots s on s.id = d.slot_id
     where d.output_hash is null and d.raw_output_json is not null and s.slot_time <= $1::timestamptz`,
    [now.toISOString()],
  );
  let revealed = 0;
  for (const { id, raw, slot_time } of rows) {
    if (callsCloseAt(new Date(slot_time)) > now) continue;
    await db.query(
      "update decisions set output_hash = decode($2::text, 'hex') where id = $1::uuid and output_hash is null",
      [id, hashJson(readExact(raw)).slice(2)],
    );
    revealed++;
  }
  return revealed;
}
