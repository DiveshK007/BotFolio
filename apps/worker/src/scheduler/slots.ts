import type { Queryable } from "./db";

export interface Slot {
  /** `slots.id`, the idempotency key of everything the slot writes (SPEC §6.1). */
  id: string;
  kind: "scheduled" | "debut";
  time: Date;
  /** null outside every season. */
  season: { id: number; startsAt: Date } | null;
}

/** The scheduled slot for this time. Every caller, in any process, gets the same row. */
export async function ensureScheduledSlot(db: Queryable, time: Date): Promise<Slot> {
  const at = time.toISOString();
  await db.query(
    `insert into slots (slot_time, kind, season_id)
     values ($1::timestamptz, 'scheduled',
             (select id from seasons where starts_at <= $1::timestamptz and ends_at > $1::timestamptz order by id limit 1))
     on conflict (slot_time) where kind = 'scheduled' do nothing`,
    [at],
  );
  const { rows } = await db.query<{ id: string; season_id: number | null; starts_at: Date | null }>(
    `select s.id::text as id, s.season_id, n.starts_at
     from slots s left join seasons n on n.id = s.season_id
     where s.kind = 'scheduled' and s.slot_time = $1::timestamptz`,
    [at],
  );
  const row = rows[0];
  if (!row) throw new Error("no slots row after the insert");
  const season =
    row.season_id === null || row.starts_at === null ? null : { id: row.season_id, startsAt: new Date(row.starts_at) };
  return { id: row.id, kind: "scheduled", time, season };
}
