import pg from "pg";
import { errorLabel, type Log } from "../auth/log";
import { checkDatabaseUrl } from "../database-url";

export interface Queryable {
  query<Row>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

export interface Db extends Queryable {
  transaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** The pool settings for DATABASE_URL, or null if it's unusable. */
export function databaseConfig(raw: string | undefined): pg.PoolConfig | null {
  const checked = checkDatabaseUrl(raw);
  return typeof checked === "string" ? null : checked;
}

/** UNVERIFIED against Supabase's pooler. Transaction mode is fine: the locks here last one transaction. */
export function openDb(config: pg.PoolConfig, log: Log): Db {
  const pool = new pg.Pool({ ...config, max: config.max ?? 10, connectionTimeoutMillis: 5_000, query_timeout: 5_000 });
  // An idle client's error would otherwise crash the whole worker.
  pool.on("error", (error) => log("db.idle_client_error", { cause: errorLabel(error) }));

  return {
    query: async <Row>(sql: string, params?: unknown[]) => ({ rows: (await pool.query(sql, params)).rows as Row[] }),
    async transaction(run) {
      const client = await pool.connect();
      let broken = false;
      // The pool stops listening while a client is checked out, and an unheard 'error' event kills the process.
      const onError = (error: Error) => {
        broken = true;
        log("db.client_error", { cause: errorLabel(error) });
      };
      client.on("error", onError);
      try {
        await client.query("begin");
        const result = await run({
          query: async <Row>(sql: string, params?: unknown[]) => ({ rows: (await client.query(sql, params)).rows as Row[] }),
        });
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => (broken = true));
        throw error;
      } finally {
        client.off("error", onError);
        client.release(broken);
      }
    },
    close: () => pool.end(),
  };
}
