import { Pool } from "pg";
import type { DatabaseConfig } from "./config";

export interface Queryable {
  query<Row extends object = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

/** Just what the indexer needs, so the tests can hand it PGlite instead of a server. */
export interface Db extends Queryable {
  /** Commits if `run` resolves, rolls back if it throws. */
  transaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createPgDb(database: DatabaseConfig): Db {
  const pool = new Pool({
    ...database,
    max: 2, // one loop, one transaction at a time
    connectionTimeoutMillis: 10_000,
    // A dead socket must not hang the loop for good. Client side, because a pooler can refuse startup parameters.
    query_timeout: 30_000,
  });
  const onError = (e: Error) => console.error(`[indexer] database connection error: ${e.message}`);
  pool.on("error", onError);

  return {
    async query<Row extends object>(text: string, params?: unknown[]) {
      const { rows } = await pool.query<Row>(text, params);
      return { rows };
    },

    async transaction<T>(run: (tx: Queryable) => Promise<T>) {
      const client = await pool.connect();
      // The pool only listens to idle clients. Without this a dropped connection would crash the worker.
      client.on("error", onError);
      let broken: Error | undefined;
      try {
        await client.query("begin");
        try {
          const result = await run({
            async query<Row extends object>(text: string, params?: unknown[]) {
              const { rows } = await client.query<Row>(text, params);
              return { rows };
            },
          });
          await client.query("commit");
          return result;
        } catch (e) {
          await client.query("rollback").catch((rollbackError: Error) => {
            broken = rollbackError;
          });
          throw e;
        }
      } finally {
        client.off("error", onError);
        client.release(broken); // with an error the pool throws the connection away
      }
    },

    close: () => pool.end(),
  };
}
