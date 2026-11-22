import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach } from "vitest";
import type { Db, Queryable } from "../../../src/scheduler/db";

const SCHEMA = readFileSync(new URL("../../../../../packages/db/schema.sql", import.meta.url), "utf8");

// What Supabase sets up before our schema runs: the API roles, and ALL to them on every new object.
// schema.sql has to take that away again, so a test as `anon` sees what the public key sees.
const SUPABASE_ROLES = `
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`;

export interface TestDb extends Db {
  /** A second worker process on the same database: the same data, and the same locks. */
  secondProcess(): Db;
  /** The worker whose lock connection dropped: locks no longer keep anyone out. */
  withoutLocks(): Db;
  asAnon<Row extends object>(sql: string): Promise<Row[]>;
}

/**
 * The real schema.sql on PGlite, emptied before each test. PGlite has one connection, so advisory locks are
 * stood in for by a set shared between "processes". The pg adapter's own lock SQL is tested separately.
 */
export function useTestDb(): TestDb {
  let pglite: PGlite;
  let tables: string[];
  let held = new Set<string>();

  beforeAll(async () => {
    pglite = await PGlite.create();
    await pglite.exec(SUPABASE_ROLES);
    await pglite.exec(SCHEMA);
    const { rows } = await pglite.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname = 'public'",
    );
    tables = rows.map((row) => row.name);
  }, 60_000);

  beforeEach(async () => {
    held = new Set();
    await pglite.exec(`truncate ${tables.join(", ")} restart identity cascade`);
  }, 30_000);

  afterAll(async () => {
    await pglite.close();
  });

  const queryable = (on: () => Pick<PGlite, "query">): Queryable => ({
    async query<Row extends object>(text: string, params?: unknown[]) {
      const { rows } = await on().query<Row>(text, params);
      return { rows };
    },
  });

  const open = (locking: boolean): Db => ({
    ...queryable(() => pglite),
    transaction: (run) => pglite.transaction((tx) => run(queryable(() => tx))),
    async withLock(key, run) {
      if (locking && held.has(key)) return { acquired: false };
      held.add(key);
      try {
        return { acquired: true, value: await run() };
      } finally {
        held.delete(key);
      }
    },
    close: async () => {},
  });

  return {
    ...open(true),
    secondProcess: () => open(true),
    withoutLocks: () => open(false),
    async asAnon<Row extends object>(sql: string) {
      return pglite.transaction(async (tx) => {
        await tx.exec("set local role anon");
        return (await tx.query<Row>(sql)).rows;
      });
    },
  };
}
