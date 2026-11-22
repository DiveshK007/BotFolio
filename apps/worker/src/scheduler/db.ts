import { Pool, type PoolClient, type PoolConfig } from "pg";
import { checkDatabaseUrl, type DatabaseConfig } from "../database-url";
import { errorLabel, type Log } from "./log";

export type { DatabaseConfig };

export interface Queryable {
  query<Row extends object = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

export interface Db extends Queryable {
  /** Commits if `run` resolves, rolls back if it throws. `run` must only use the `tx` it is given. */
  transaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T>;
  /** Runs `run` while holding the advisory lock for `key`, or not at all if someone else holds it. */
  withLock<T>(key: string, run: () => Promise<T>): Promise<{ acquired: false } | { acquired: true; value: T }>;
  close(): Promise<void>;
}

export function databaseConfig(raw: string | undefined): DatabaseConfig | string {
  const checked = checkDatabaseUrl(raw);
  return typeof checked === "string" ? `DATABASE_URL ${checked}` : checked;
}

/** A transaction-level lock ends with its transaction, so a pooler in transaction mode can't strand it. */
export const TRY_LOCK_SQL = "select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as locked";

/**
 * Two pools on purpose: a job holds its lock connection for the whole run and needs query connections
 * meanwhile. With one pool, enough running jobs would wait for each other's connections.
 * UNVERIFIED against Supabase and its pooler.
 */
export function createPgDb(database: DatabaseConfig, log: Log, newPool = (config: PoolConfig) => new Pool(config)): Db {
  const onError = (error: Error) => log.warn("scheduler.db_connection_error", { error: errorLabel(error) });
  const open = (max: number) => {
    // query_timeout is client side, so a dead socket can't hang a slot.
    const pool = newPool({ ...database, max, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
    // Without a listener an idle connection's error would crash the worker.
    pool.on("error", onError);
    return pool;
  };
  const queries = open(5);
  // One per job that can run at once: the six crons and the debut watcher, plus one spare.
  const locks = open(8);

  const queryable = (on: Pool | PoolClient): Queryable => ({
    async query<Row extends object>(text: string, params?: unknown[]) {
      const { rows } = await on.query<Row>(text, params);
      return { rows };
    },
  });

  return {
    ...queryable(queries),

    async transaction(run) {
      const client = await queries.connect();
      client.on("error", onError);
      let broken: Error | undefined;
      try {
        await client.query("begin");
        const result = await run(queryable(client));
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch((e: Error) => (broken = e));
        throw error;
      } finally {
        client.off("error", onError);
        client.release(broken);
      }
    },

    async withLock(key, run) {
      const client = await locks.connect();
      client.on("error", onError);
      let broken: Error | undefined;
      try {
        await client.query("begin");
        const { rows } = await client.query<{ locked: boolean }>(TRY_LOCK_SQL, [`botfolio:${key}`]);
        if (!rows[0]?.locked) return { acquired: false };
        return { acquired: true, value: await run() };
      } finally {
        // Ending the transaction frees the lock. If that fails, dropping the connection frees it too.
        await client.query("rollback").catch((e: Error) => (broken = e));
        client.off("error", onError);
        client.release(broken);
      }
    },

    async close() {
      await Promise.all([queries.end(), locks.end()]);
    },
  };
}
