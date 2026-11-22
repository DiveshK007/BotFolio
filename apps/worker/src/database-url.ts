/** What pg gets. `ssl` is set when a remote URL names no sslmode: pg would send the password in plain text otherwise. */
export interface DatabaseConfig {
  connectionString: string;
  ssl?: true;
}

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
  if (mode === undefined) return { connectionString: value, ssl: true };
  return TLS_MODES.has(mode) ? { connectionString: value } : "must use TLS for a remote server";
}
