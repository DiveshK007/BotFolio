# packages/db — WS B (Runner)
`schema.sql` (all SPEC §3 tables incl. v1.1 additions) is written and frozen on Day 1 (Fri Nov 20, 23:00). Migrations go in `migrations/`.

## Files
- `schema.sql` — the full current schema: domains, enums, tables, indexes, and the `site_*` views/functions that are the web's only public read surface (SPEC §3, §11). Frozen interface: change only through one announced PR.
- `migrations/NNNN_short_name.sql` — the same schema as ordered steps. Four-digit prefix, applied in filename order, never edited after merge. `0001_init.sql` is `schema.sql` at freeze time.
- `seeds/seasons.sql` — the season rows from SPEC §1 (S0–S19). Safe to run again.

## Changing the schema
1. Add the next migration (`0002_…sql`) with only the change.
2. Apply the same change to `schema.sql`, so it stays the full current state.
3. Check both give the same result: apply `schema.sql` to one empty database and all migrations in order to another, then compare `information_schema.columns`, `pg_indexes` and `pg_views`.

## Applying
- Supabase: paste the migration into the SQL editor, or `psql "$DATABASE_URL" -f migrations/0001_init.sql`.
- `0001_init.sql` turns RLS on for every table and leaves `anon` / `authenticated` with SELECT on the `site_*` views only. A migration that adds a table or view must do the same for it. Testing with a real Supabase anon key is still open (#154).
- Seasons, after the migrations: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f seeds/seasons.sql`. Without these rows the indexer can't store season events or challenges, and slots belong to no season.
