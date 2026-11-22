import { Pool, type PoolClient, type PoolConfig } from "pg";
import { errorLabel, type Log } from "./log";

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

export interface DatabaseConfig {
  connectionString: string;
  /** Set when a remote URL names no sslmode: pg would send the password in plain text otherwise. */
  ssl?: true;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const TLS_MODES = new Set(["require", "verify-ca", "verify-full"]);

/**
 * Plain text only to this machine, the same rule as the relayer's and the indexer's.
 * A string says what is wrong, and never repeats the value (it holds a password).
 */
export function databaseConfig(raw: string | undefined): DatabaseConfig | string {
  const value = raw?.trim() ?? "";
  if (!value || /replace[-_ ]?me/i.test(value)) return "DATABASE_URL is not set";
  if (!URL.canParse(value)) return "DATABASE_URL is not a URL";
  const url = new URL(value);
  if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:") || !url.hostname) {
    return "DATABASE_URL is not a postgres:// URL";
  }
  // pg lets these two override the host and the TLS setting checked below.
  if (url.searchParams.has("host") || url.searchParams.has("ssl")) {
    return "DATABASE_URL must not set host or ssl as parameters";
  }
  if (LOCAL_HOSTS.has(url.hostname)) return { connectionString: value };

  const mode = url.searchParams.get("sslmode");
  if (mode === null) return { connectionString: value, ssl: true };
  return TLS_MODES.has(mode) ? { connectionString: value } : "DATABASE_URL must use TLS for a remote server";
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
  const locks = open(3);

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
