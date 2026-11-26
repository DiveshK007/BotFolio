#!/usr/bin/env bash
# Sets up a FRESH database (Supabase prod, or a throwaway Postgres): the full schema, then the season rows.
# Refuses a database that already has the schema; later changes go in one at a time:
#   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/migrations/NNNN_name.sql
#
#   DATABASE_URL=postgres://… scripts/db/setup.sh
# Never paste DATABASE_URL into a chat or an issue (it holds the password).
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?set DATABASE_URL (Supabase → Project Settings → Database → connection string, session mode)}"

psql_() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"; }

if [ "$(psql_ -tAc "select to_regclass('public.bots') is not null")" = "t" ]; then
  echo "this database already has the schema; apply new migrations one by one instead (see packages/db/README.md)" >&2
  exit 1
fi

# schema.sql is every migration applied in order (packages/db/README.md), so a fresh database needs only it.
psql_ -f packages/db/schema.sql
psql_ -f packages/db/seeds/seasons.sql
echo "schema + $(psql_ -tAc 'select count(*) from seasons') season rows"
echo "next: house-bot drafts (docs/deploy.md step 6)"
