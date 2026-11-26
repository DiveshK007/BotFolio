import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll } from "vitest";
import type { Db } from "../../../src/relay/db";

const SCHEMA = readFileSync(new URL("../../../../../packages/db/schema.sql", import.meta.url), "utf8");

let shared: Promise<PGlite> | undefined;
afterAll(async () => {
  await (await shared)?.close();
});

async function boot(): Promise<PGlite> {
  const pg = await PGlite.create();
  await pg.exec(SCHEMA);
  return pg;
}

/** Real Postgres (WASM, in memory) with the frozen schema.sql applied. One per test file, emptied per test. */
export async function testDb(): Promise<{ db: Db; pg: PGlite }> {
  const pg = await (shared ??= boot());
  await pg.exec("truncate relay_log, users cascade");
  const db: Db = {
    query: async <Row>(sql: string, params?: unknown[]) => ({ rows: (await pg.query(sql, params)).rows as Row[] }),
    transaction: (run) =>
      pg.transaction((tx) =>
        run({ query: async <Row>(sql: string, params?: unknown[]) => ({ rows: (await tx.query(sql, params)).rows as Row[] }) }),
      ),
    close: () => pg.close(),
  };
  return { db, pg };
}
