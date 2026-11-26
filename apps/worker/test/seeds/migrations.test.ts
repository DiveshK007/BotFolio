import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB = new URL("../../../../packages/db/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, DB), "utf8");

const CHECKS = `select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
  from pg_constraint where contype = 'c' and conname like '%action_index%' order by 1`;
const VIEWS = `select viewname, definition from pg_views where schemaname = 'public' order by 1`;

// packages/db/README.md: every migration in order must give the same result as schema.sql.
describe("migrations in order = schema.sql", () => {
  let migrated: PGlite;
  let fresh: PGlite;
  beforeAll(async () => {
    migrated = new PGlite();
    for (const file of readdirSync(new URL("migrations/", DB)).filter((f) => f.endsWith(".sql")).sort()) {
      await migrated.exec(read(`migrations/${file}`));
    }
    fresh = new PGlite();
    await fresh.exec(read("schema.sql"));
  }, 30_000);
  afterAll(() => Promise.all([migrated.close(), fresh.close()]));

  it("0003: action_index is 0-4 for trades and big_moves", async () => {
    const rows = (await migrated.query(CHECKS)).rows;
    expect(rows).toEqual((await fresh.query(CHECKS)).rows);
    expect(rows).toEqual([
      { tbl: "big_moves", conname: "big_moves_action_index_check", def: "CHECK (((action_index >= 0) AND (action_index <= 4)))" },
      { tbl: "trades", conname: "trades_action_index_check", def: "CHECK (((action_index >= 0) AND (action_index <= 4)))" },
    ]);
  });

  it("0004: the public views are the same, and S0's results and trust scores are not in them", async () => {
    expect((await migrated.query(VIEWS)).rows).toEqual((await fresh.query(VIEWS)).rows);
    await fresh.exec(`
      insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades) values
        (0, '2026-11-27 00:00+05:30', '2026-11-28 21:30+05:30', 'sprint', 8),
        (1, '2026-11-29 00:00+05:30', '2026-11-30 21:30+05:30', 'sprint', 8);
      insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash)
        values (1, '0x${"11".repeat(20)}', 'A', 'a', '', '\\x${"00".repeat(32)}');
      insert into season_results (season_id, bot_id, start_value_e8, end_value_e8, return_bps, max_dd_bps, trades)
        values (0, 1, 1, 1, 0, 0, 0), (1, 1, 1, 1, 0, 0, 0);`);
    expect((await fresh.query("select season_id from site_season_results")).rows).toEqual([{ season_id: 1 }]);
    expect((await fresh.query("select bot_id from site_leaderboards(0)")).rows).toEqual([]);
  });
});
