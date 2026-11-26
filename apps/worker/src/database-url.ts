import { SUPABASE_ROOT_CA } from "./supabase-ca";

/** What pg gets. `ssl` is set when a remote URL names no sslmode: pg would send the password in plain text otherwise. */
export interface DatabaseConfig {
  connectionString: string;
  ssl?: true | { ca: string };
}

/** Supabase's Postgres and pooler hosts, whose certificates chain to the Supabase root CA, not a public one. */
const isSupabaseHost = (host: string) => host.endsWith(".supabase.com") || host.endsWith(".supabase.co");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const TLS_MODES = new Set(["require", "verify-ca", "verify-full"]);

/**
 * The worker's one check of DATABASE_URL: plain text only to this machine, verified TLS to any other.
 * A string says what is wrong and never repeats the value (it holds a password).
 */
export function checkDatabaseUrl(raw: string | undefined): DatabaseConfig | string {
  const value = raw?.trim() ?? "";
  if (!value || /replace[-_ ]?me/i.test(value)) return "is not set";
  if (!URL.canParse(value)) return "is not a URL";
  const url = new URL(value);
  if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:") || !url.hostname) {
    return "is not a postgres:// URL";
  }
  // pg lets these override the host, or the TLS checking, that is checked below.
  for (const name of ["host", "ssl", "uselibpqcompat"]) {
    if (url.searchParams.has(name)) return `must not set ${name} as a parameter`;
  }
  if (LOCAL_HOSTS.has(url.hostname)) return { connectionString: value };

  const modes = url.searchParams.getAll("sslmode");
  if (modes.length > 1) return "must set sslmode once"; // pg would use the last one, and we'd have checked the first
  const mode = modes[0];
  if (mode !== undefined && !TLS_MODES.has(mode)) return "must use TLS for a remote server";
  if (isSupabaseHost(url.hostname)) {
    // Still verified, against Supabase's own root. pg lets a URL's sslmode replace the ssl object, so drop it.
    url.searchParams.delete("sslmode");
    return { connectionString: url.toString(), ssl: { ca: SUPABASE_ROOT_CA } };
  }
  return mode === undefined ? { connectionString: value, ssl: true } : { connectionString: value };
}

/**
 * The Supabase session pooler refuses clients past its pool_size: 15 on the small tiers.
 * UNVERIFIED for our project (Supabase → Database → Settings → Pool size).
 */
export const SESSION_POOLER_LIMIT = 15;

/** Every pg pool the worker opens and its max. They must add up to SESSION_POOLER_LIMIT or less (docs/env.md). */
export const POOL_MAX = {
  /** One per job running at once: at 16:00 UTC season_close, daily_call_settle, big_move_sweep and the debut watcher, plus one spare. */
  schedulerLocks: 5,
  /** Shared by the slot's lanes. Their transactions are short and use only their own client. */
  schedulerQueries: 3,
  /** One loop, one transaction at a time. */
  indexer: 2,
  /** The public read routes and the card and .qie name sweepers. */
  reads: 2,
  /** Relays queue on one advisory lock anyway. */
  relay: 2,
  persona: 1,
} as const;
