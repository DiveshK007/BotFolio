import { isAddress, zeroAddress, type Address } from "viem";
import { CONTRACT_NAMES, type ContractName } from "./abi";

type Env = Record<string, string | undefined>;

export type ContractAddresses = Record<ContractName, Address>;

export const ADDRESS_ENV: Record<ContractName, string> = {
  BotForwarder: "FORWARDER_ADDRESS",
  BotRegistry: "BOT_REGISTRY_ADDRESS",
  PaperLedger: "PAPER_LEDGER_ADDRESS",
  SeasonLedger: "SEASON_LEDGER_ADDRESS",
  TrustScoreRegistry: "TRUST_REGISTRY_ADDRESS",
  DailyCall: "DAILY_CALL_ADDRESS",
  Challenges: "CHALLENGES_ADDRESS",
};

export interface DatabaseConfig {
  connectionString: string;
  /** Set when a remote URL names no sslmode: pg would send the password in plain text otherwise. */
  ssl?: true;
}

export interface IndexerConfig {
  database: DatabaseConfig;
  /** Lowercase. These are the only log sources the indexer accepts. */
  addresses: ContractAddresses;
  /** The block of the first deploy tx. */
  startBlock: bigint;
}

/**
 * All or nothing: with one address missing we would index a history with holes in it and call it complete.
 * `problems` names variables, never their values (DATABASE_URL holds a password).
 */
export function loadIndexerConfig(
  env: Env = process.env,
): { ok: true; config: IndexerConfig } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const addresses = {} as ContractAddresses;
  const seen = new Map<string, string>();

  for (const contract of CONTRACT_NAMES) {
    const name = ADDRESS_ENV[contract];
    const value = env[name]?.trim().toLowerCase() ?? "";
    if (!value) problems.push(`${name} is not set`);
    else if (!isAddress(value) || value === zeroAddress) problems.push(`${name} is not a contract address`);
    else if (seen.has(value)) problems.push(`${name} repeats ${seen.get(value)}`);
    else {
      seen.set(value, name);
      addresses[contract] = value;
    }
  }

  const database = databaseConfig(env.DATABASE_URL?.trim() ?? "");
  if (typeof database === "string") problems.push(`DATABASE_URL ${database}`);

  const start = env.INDEXER_START_BLOCK?.trim() ?? "";
  if (!start) problems.push("INDEXER_START_BLOCK is not set (the deploy block)");
  else if (!/^\d+$/.test(start)) problems.push("INDEXER_START_BLOCK is not a block number");

  if (problems.length > 0 || typeof database === "string") return { ok: false, problems };
  return { ok: true, config: { database, addresses, startBlock: BigInt(start) } };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const TLS_MODES = new Set(["require", "verify-ca", "verify-full"]);

/** The same rule as the relayer's: plain text only to this machine. A string says what's wrong with the URL. */
function databaseConfig(value: string): DatabaseConfig | string {
  if (!value) return "is not set";
  if (!URL.canParse(value)) return "is not a URL";
  const url = new URL(value);
  if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:") || !url.hostname) {
    return "is not a postgres:// URL";
  }
  // pg lets these two override the host and the TLS setting checked below.
  if (url.searchParams.has("host") || url.searchParams.has("ssl")) return "must not set host or ssl as parameters";
  if (LOCAL_HOSTS.has(url.hostname)) return { connectionString: value };

  const mode = url.searchParams.get("sslmode");
  if (mode === null) return { connectionString: value, ssl: true };
  return TLS_MODES.has(mode) ? { connectionString: value } : "must use TLS for a remote server";
}
