import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { Client } from "pg";
import { createPgDb, type Db, type Queryable } from "../../../src/indexer/db";

const SCHEMA = readFileSync(new URL("../../../../../packages/db/schema.sql", import.meta.url), "utf8");

export interface TestDb extends Db {
  reset(): Promise<void>;
  /** Every row of every table, as exact text (no float or bigint rounding on the way). */
  snapshot(): Promise<Record<string, string[]>>;
}

/**
 * The real schema.sql on PGlite. INDEXER_TEST_PG_URL runs the same tests through `pg` on a real server instead
 * (a throwaway database is created there and dropped again).
 */
export async function createTestDb(): Promise<TestDb> {
  const serverUrl = process.env.INDEXER_TEST_PG_URL;
  const db = serverUrl ? await onServer(serverUrl) : await onPglite();

  const { rows } = await db.query<{ name: string }>(
    "select tablename as name from pg_tables where schemaname = 'public' order by 1",
  );
  const tables = rows.map((row) => row.name);

  return {
    ...db,
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

async function onPglite(): Promise<Db> {
  const pglite = new PGlite();
  await pglite.exec(SCHEMA);
  const on = (runner: Pick<PGlite, "query">): Queryable => ({
    async query<Row extends object>(text: string, params?: unknown[]) {
      const { rows } = await runner.query<Row>(text, params);
      return { rows };
    },
  });
  return {
    ...on(pglite),
    transaction: (run) => pglite.transaction((tx) => run(on(tx))),
    close: () => pglite.close(),
  };
}

async function onServer(serverUrl: string): Promise<Db> {
  const name = `indexer_test_${randomBytes(6).toString("hex")}`;
  const admin = new Client({ connectionString: serverUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;

  const db = createPgDb(url.toString());
  await db.query(SCHEMA);
  return {
    ...db,
    async close() {
      await db.close();
      await admin.query(`drop database ${name} with (force)`);
      await admin.end();
    },
  };
}
