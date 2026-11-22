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

export interface IndexerConfig {
  databaseUrl: string;
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

  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) problems.push("DATABASE_URL is not set");
  else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) problems.push("DATABASE_URL is not a postgres:// URL");

  const start = env.INDEXER_START_BLOCK?.trim() ?? "";
  if (!start) problems.push("INDEXER_START_BLOCK is not set (the deploy block)");
  else if (!/^\d+$/.test(start)) problems.push("INDEXER_START_BLOCK is not a block number");

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, config: { databaseUrl, addresses, startBlock: BigInt(start) } };
}
