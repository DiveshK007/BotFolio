import pg from "pg";
import { errorLabel, type Log } from "../auth/log";

export interface Queryable {
  query<Row>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

export interface Db extends Queryable {
  transaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const TLS_MODES = new Set(["require", "verify-ca", "verify-full"]);

/**
 * The pool settings for DATABASE_URL, or null if it's unusable: missing, placeholder or a remote DB without TLS.
 * A remote URL with no sslmode gets verified TLS.
 */
export function databaseConfig(raw: string | undefined): pg.PoolConfig | null {
  if (!raw || /replace[-_ ]?me/i.test(raw) || !URL.canParse(raw)) return null;
  const url = new URL(raw);
  if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:") || !url.hostname) return null;
  if (LOCAL_HOSTS.has(url.hostname) && !url.searchParams.has("host")) return { connectionString: raw };
  if (url.searchParams.has("host") || url.searchParams.has("ssl")) return null;
  const mode = url.searchParams.get("sslmode");
  if (mode === null) return { connectionString: raw, ssl: true };
  return TLS_MODES.has(mode) ? { connectionString: raw } : null;
}

/** UNVERIFIED against Supabase's pooler. Transaction mode is fine: the locks here last one transaction. */
export function openDb(config: pg.PoolConfig, log: Log): Db {
  const pool = new pg.Pool({ ...config, max: 10, connectionTimeoutMillis: 5_000, query_timeout: 5_000 });
  // An idle client's error would otherwise crash the whole worker.
  pool.on("error", (error) => log("db.idle_client_error", { cause: errorLabel(error) }));

  return {
    query: async <Row>(sql: string, params?: unknown[]) => ({ rows: (await pool.query(sql, params)).rows as Row[] }),
    async transaction(run) {
      const client = await pool.connect();
      let broken = false;
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
        client.release(broken);
      }
    },
    close: () => pool.end(),
  };
}
