-- Season rows, exactly the SPEC §1 table. Times are IST.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/seeds/seasons.sql
--
--   S0-S4  sprint, 2 days each (00:00 to 21:30 the next day), provisional below 8 trades, trust-v1-sprint.
--          S0 is the hidden test season and starts on the contracts' deploy day (Nov 27).
--   S5+    weekly Mon 00:00 to Sun 21:30 from Dec 7, provisional below 20 trades, trust-v1.
--          Through S18, the week that holds Mar 10 2027 (#195).
--
-- Safe to run again. A season the worker has started using (it has a slot, or a close tx) is left as it is,
-- because the worker and the indexer write status, roots and the chain's times into it. A season nothing has
-- used yet takes this file's times, so a moved calendar (Nov 26, #219) reaches a database seeded with the old
-- one; an unused row past the end of the calendar is removed.

with sprint (id, starts_at, ends_at) as (
  values
    (0, timestamptz '2026-11-27 00:00:00+05:30', timestamptz '2026-11-28 21:30:00+05:30'),
    (1, timestamptz '2026-11-29 00:00:00+05:30', timestamptz '2026-11-30 21:30:00+05:30'),
    (2, timestamptz '2026-12-01 00:00:00+05:30', timestamptz '2026-12-02 21:30:00+05:30'),
    (3, timestamptz '2026-12-03 00:00:00+05:30', timestamptz '2026-12-04 21:30:00+05:30'),
    (4, timestamptz '2026-12-05 00:00:00+05:30', timestamptz '2026-12-06 21:30:00+05:30')
),
weekly (id, starts_at) as (
  -- In hours, not days, so the session's time zone and its DST can't move a boundary.
  select 5 + week, timestamptz '2026-12-07 00:00:00+05:30' + week * interval '168 hours'
  from generate_series(0, 13) as week
),
season (id, starts_at, ends_at, kind, provisional_min_trades, trust_rules_version) as (
  select id, starts_at, ends_at, 'sprint', 8, 'trust-v1-sprint' from sprint
  union all
  -- Sunday 21:30 is 6 days 21.5 hours after Monday 00:00.
  select id, starts_at, starts_at + interval '165 hours 30 minutes', 'weekly', 20, 'trust-v1' from weekly
),
unused as (
  select id from seasons s
  where s.root_tx is null and not exists (select 1 from slots where slots.season_id = s.id)
),
dropped as (
  delete from seasons
  where id in (select id from unused) and id > (select max(id) from season)
)
insert into seasons as s (id, starts_at, ends_at, kind, provisional_min_trades, trust_rules_version)
select id, starts_at, ends_at, kind::season_kind, provisional_min_trades, trust_rules_version
from season
on conflict (id) do update
  set starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      kind = excluded.kind,
      provisional_min_trades = excluded.provisional_min_trades,
      trust_rules_version = excluded.trust_rules_version
  where s.id in (select id from unused);
