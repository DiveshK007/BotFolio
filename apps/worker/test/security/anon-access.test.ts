import { describe, expect, it } from "vitest";
import { useTestDb } from "../scheduler/helpers/db";

/*
 * #154: what the public (anon) key can read. schema.sql runs on PGlite after Supabase's own setup (anon role,
 * default ALL grants), so these are the rights the public key gets from schema.sql alone.
 * Supabase's live database is not checked here: that needs the real anon key (UNVERIFIED).
 */

const PRIVATE = ["users", "relay_log", "big_moves", "daily_calls"];

describe("anon access (schema.sql access-control section)", () => {
  const db = useTestDb();

  const names = async (sql: string) => (await db.query<{ name: string }>(sql)).rows.map((r) => r.name);
  const baseTables = () => names("select tablename as name from pg_tables where schemaname = 'public'");
  const views = () => names("select viewname as name from pg_views where schemaname = 'public'");

  it.each(PRIVATE)("cannot select from %s", async (table) => {
    await expect(db.asAnon(`select * from ${table}`)).rejects.toThrow(/permission denied/);
  });

  it("cannot select from any base table", async () => {
    const tables = await baseTables();
    expect(tables).toEqual(expect.arrayContaining(PRIVATE));
    for (const table of tables) {
      await expect(db.asAnon(`select 1 from ${table}`), table).rejects.toThrow(/permission denied/);
    }
  });

  it("cannot read big_moves.runner_sig or daily_calls.bot_up_sig, even column by column", async () => {
    await expect(db.asAnon("select runner_sig from big_moves")).rejects.toThrow(/permission denied/);
    await expect(db.asAnon("select bot_up_sig from daily_calls")).rejects.toThrow(/permission denied/);
  });

  it("reads every site_* view, and the site_* views are the only views", async () => {
    const all = await views();
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((v) => !v.startsWith("site_"))).toEqual([]);
    for (const view of all) await expect(db.asAnon(`select * from ${view}`), view).resolves.toEqual(expect.any(Array));
  });

  it("calls the public site_* functions", async () => {
    await expect(db.asAnon("select * from site_leaderboards(1)")).resolves.toEqual([]);
    await expect(db.asAnon("select * from site_challenge_by_short_code('0123456789abcdef')")).resolves.toEqual([]);
  });

  it("the public views leave out the signatures and the users table", async () => {
    const { rows } = await db.query<{ table_name: string; column_name: string }>(
      "select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name like 'site\\_%'",
    );
    const columns = rows.map((r) => r.column_name);
    expect(columns).not.toContain("runner_sig");
    expect(columns).not.toContain("bot_up_sig");
    expect(columns).not.toContain("privy_did");
  });

  // site_cards and site_big_moves are simple views: Postgres would let them be written, as their owner.
  it("cannot write through a view or into a table", async () => {
    await expect(db.asAnon("delete from site_cards")).rejects.toThrow(/permission denied/);
    await expect(db.asAnon("update site_big_moves set status = 'expired'")).rejects.toThrow(/permission denied/);
    await expect(db.asAnon("delete from users")).rejects.toThrow(/permission denied/);
  });
});
