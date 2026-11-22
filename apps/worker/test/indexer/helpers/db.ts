import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { Db, Queryable } from "../../../src/indexer/db";

const SCHEMA = readFileSync(new URL("../../../../../packages/db/schema.sql", import.meta.url), "utf8");

export interface TestDb extends Db {
  reset(): Promise<void>;
  /** Every row of every table, as exact text (no float or bigint rounding on the way). */
  snapshot(): Promise<Record<string, string[]>>;
}

/** The real schema.sql on PGlite (Postgres in WASM). */
export async function createTestDb(): Promise<TestDb> {
  const pglite = new PGlite();
  await pglite.exec(SCHEMA);

  const on = (runner: Pick<PGlite, "query">): Queryable => ({
    async query<Row extends object>(text: string, params?: unknown[]) {
      const { rows } = await runner.query<Row>(text, params);
      return { rows };
    },
  });
  const db = on(pglite);

  const { rows } = await db.query<{ name: string }>(
    "select tablename as name from pg_tables where schemaname = 'public' order by 1",
  );
  const tables = rows.map((row) => row.name);

  return {
    ...db,
    transaction: (run) => pglite.transaction((tx) => run(on(tx))),
    close: () => pglite.close(),
    async reset() {
      await db.query(`truncate ${tables.join(", ")} restart identity cascade`);
    },
    async snapshot() {
      const all: Record<string, string[]> = {};
      for (const table of tables) {
        const result = await db.query<{ row: string }>(`select to_jsonb(t)::text as row from ${table} t`);
        all[table] = result.rows.map((r) => r.row).sort();
      }
      return all;
    },
  };
}
