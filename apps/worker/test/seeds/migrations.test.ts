import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../../../packages/db/${path}`, import.meta.url), "utf8");

const CHECKS = `select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
  from pg_constraint where contype = 'c' and conname like '%action_index%' order by 1`;

describe("0003_action_index_0_4.sql", () => {
  it("gives the same action_index checks as schema.sql: 0-4 for trades and big_moves", async () => {
    const migrated = new PGlite();
    await migrated.exec(read("migrations/0001_init.sql"));
    await migrated.exec(read("migrations/0003_action_index_0_4.sql"));
    const fresh = new PGlite();
    await fresh.exec(read("schema.sql"));

    const rows = (await migrated.query(CHECKS)).rows;
    expect(rows).toEqual((await fresh.query(CHECKS)).rows);
    expect(rows).toEqual([
      { tbl: "big_moves", conname: "big_moves_action_index_check", def: "CHECK (((action_index >= 0) AND (action_index <= 4)))" },
      { tbl: "trades", conname: "trades_action_index_check", def: "CHECK (((action_index >= 0) AND (action_index <= 4)))" },
    ]);
    await Promise.all([migrated.close(), fresh.close()]);
  }, 30_000);
});
