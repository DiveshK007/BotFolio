import { EventEmitter } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import type { Pool, PoolConfig } from "pg";
import { describe, expect, it } from "vitest";
import { POOL_MAX } from "../../src/database-url";
import { createPgDb, databaseConfig, TRY_LOCK_SQL } from "../../src/scheduler/db";
import { memoryLog } from "./helpers/log";

describe("databaseConfig", () => {
  it.each(["postgres://u:p@localhost:5432/x", "postgres://u:p@db.example.com/x?sslmode=verify-full"])("takes %s", (url) => {
    expect(databaseConfig(url)).toEqual({ connectionString: url });
  });

  it("turns verified TLS on for a remote URL that names no sslmode", () => {
    const url = "postgres://u:p@db.example.com/x";
    expect(databaseConfig(url)).toEqual({ connectionString: url, ssl: true });
  });

  it.each([
    undefined,
    "replace-me",
    "not a url",
    "https://db.example.com",
    "postgres://u:hunter2@db.example.com/x?sslmode=disable",
    "postgres://u:hunter2@localhost/x?host=db.example.com",
  ])("refuses %s without repeating it", (url) => {
    const problem = databaseConfig(url);
    expect(problem).toMatch(/^DATABASE_URL /);
    expect(problem).not.toContain("hunter2");
  });
});

/** pg's Pool, recording the SQL each pool runs. */
function fakePools(options: { locked?: boolean; failOn?: string } = {}) {
  const pools: { config: PoolConfig; sql: string[]; released: unknown[] }[] = [];
  const newPool = (config: PoolConfig) => {
    const record = { config, sql: [] as string[], released: [] as unknown[] };
    pools.push(record);
    const query = async (sql: string) => {
      record.sql.push(sql);
      if (sql === options.failOn) throw new Error("connection lost");
      return { rows: sql === TRY_LOCK_SQL ? [{ locked: options.locked ?? true }] : [] };
    };
    const client = Object.assign(new EventEmitter(), { query, release: (e?: unknown) => void record.released.push(e) });
    return Object.assign(new EventEmitter(), { query, connect: async () => client, end: async () => {} }) as unknown as Pool;
  };
  const db = createPgDb({ connectionString: "postgres://localhost/x" }, memoryLog(), newPool);
  return { db, queries: pools[0]!, locks: pools[1]! };
}

describe("createPgDb", () => {
  it("caps both pools at their share of the session pooler (#351)", () => {
    const { queries, locks } = fakePools();
    expect([queries.config.max, locks.config.max]).toEqual([POOL_MAX.schedulerQueries, POOL_MAX.schedulerLocks]);
  });

  it("holds the lock in its own pool's transaction for the whole run", async () => {
    const { db, queries, locks } = fakePools();
    const result = await db.withLock("slot:x", async () => {
      expect(locks.sql).toEqual(["begin", TRY_LOCK_SQL]);
      await db.query("select 1");
      return 7;
    });
    expect(result).toEqual({ acquired: true, value: 7 });
    expect(locks.sql).toEqual(["begin", TRY_LOCK_SQL, "rollback"]);
    expect(queries.sql).toEqual(["select 1"]);
    expect(locks.released).toEqual([undefined]);
  });

  it("doesn't run without the lock", async () => {
    const { db } = fakePools({ locked: false });
    let ran = false;
    expect(await db.withLock("slot:x", async () => (ran = true))).toEqual({ acquired: false });
    expect(ran).toBe(false);
  });

  it("frees the lock when the run throws", async () => {
    const { db, locks } = fakePools();
    await expect(db.withLock("slot:x", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(locks.sql.at(-1)).toBe("rollback");
    expect(locks.released).toHaveLength(1);
  });

  it("throws away a lock connection it can't end", async () => {
    const { db, locks } = fakePools({ failOn: "rollback" });
    await db.withLock("slot:x", async () => {});
    expect(locks.released[0]).toBeInstanceOf(Error);
  });

  it("commits, and rolls back on a throw", async () => {
    const { db, queries } = fakePools();
    await db.transaction(async () => {});
    await expect(db.transaction(() => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(queries.sql).toEqual(["begin", "commit", "begin", "rollback"]);
  });

  it("the lock SQL is valid Postgres", async () => {
    const pglite = await PGlite.create();
    try {
      expect((await pglite.query(TRY_LOCK_SQL, ["botfolio:slot:x"])).rows).toEqual([{ locked: true }]);
    } finally {
      await pglite.close();
    }
  }, 60_000);
});
