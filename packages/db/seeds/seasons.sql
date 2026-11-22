-- Season rows, exactly the SPEC §1 table. Times are IST.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/seeds/seasons.sql
--
-- Safe to run again: a season that already has a row is left as it is, because the worker and the indexer
-- write status, roots and (if the chain says so) times into it afterwards.
--
--   S0-S5  sprint, provisional below 8 trades, trust-v1-sprint
--   S6+    weekly Mon 00:00 to Sun 21:30, provisional below 20 trades, trust-v1.
--          Through S19, the week that holds Mar 10 2027 (#195).

with sprint (id, starts_at, ends_at) as (
  values
    (0, timestamptz '2026-11-24 00:00:00+05:30', timestamptz '2026-11-25 21:30:00+05:30'),
    (1, timestamptz '2026-11-26 00:00:00+05:30', timestamptz '2026-11-27 21:30:00+05:30'),
    (2, timestamptz '2026-11-28 00:00:00+05:30', timestamptz '2026-11-29 21:30:00+05:30'),
    (3, timestamptz '2026-11-30 00:00:00+05:30', timestamptz '2026-12-01 21:30:00+05:30'),
    (4, timestamptz '2026-12-02 00:00:00+05:30', timestamptz '2026-12-03 21:30:00+05:30'),
    (5, timestamptz '2026-12-04 00:00:00+05:30', timestamptz '2026-12-06 21:30:00+05:30')
),
weekly (id, starts_at) as (
  -- In hours, not days, so the session's time zone and its DST can't move a boundary.
  select 6 + week, timestamptz '2026-12-07 00:00:00+05:30' + week * interval '168 hours'
  from generate_series(0, 13) as week
),
season (id, starts_at, ends_at, kind, provisional_min_trades, trust_rules_version) as (
  select id, starts_at, ends_at, 'sprint', 8, 'trust-v1-sprint' from sprint
  union all
  -- Sunday 21:30 is 6 days 21.5 hours after Monday 00:00.
  select id, starts_at, starts_at + interval '165 hours 30 minutes', 'weekly', 20, 'trust-v1' from weekly
)
insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades, trust_rules_version)
select id, starts_at, ends_at, kind::season_kind, provisional_min_trades, trust_rules_version
from season
on conflict (id) do nothing;
