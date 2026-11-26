import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { secret, type Env } from "../auth/env";
import { errorLabel, type Log } from "../auth/log";
import type { AuthSetup } from "../auth/setup";
import { POOL_MAX } from "../database-url";
import { loadRelayContracts } from "./allowlist";
import { ForwarderChain } from "./chain";
import { databaseConfig, openDb, type Db } from "./db";
import { PgRelayGuard } from "./guard";
import { loadRateLimits } from "./limits";
import { NonceManager } from "./nonce-manager";
import { createRelay, type Relay } from "./pipeline";
import { RelayRpc } from "./rpc";

export interface RelayerService {
  /** null = switched off: /relay answers RELAY_DISABLED and no key is ever used. */
  relay: Relay | null;
  /** Why it's off: variable names only, never values. */
  problems: string[];
  start(): void;
  stop(): Promise<void>;
}

interface SetupOptions {
  env: Env;
  auth: AuthSetup;
  rpcUrls: readonly string[];
  log: Log;
  openDatabase?: typeof openDb;
}

const OTHER_KEYS = ["RUNNER_PRIVATE_KEY", "COMMITTER_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"];
const normaliseKey = (key: string | undefined) => key?.trim().toLowerCase().replace(/^0x/, "") ?? "";

/**
 * All or nothing: the relay only starts when it is explicitly enabled and every setting it relies on is valid.
 * RELAY_ENABLED must be exactly "true". Missing is off, so a half-configured deploy can't spend gas.
 */
export function setUpRelayer({ env, auth, rpcUrls, log, openDatabase = openDb }: SetupOptions): RelayerService {
  const off = (problems: string[]): RelayerService => ({ relay: null, problems, start() {}, stop: async () => {} });
  if (env.RELAY_ENABLED?.trim() !== "true") return off(["RELAY_ENABLED"]);

  const problems = [...auth.problems];
  const contracts = loadRelayContracts(env);
  if (!contracts.ok) problems.push(...contracts.problems);
  const limits = loadRateLimits(env);
  if (!limits.ok) problems.push(...limits.problems);
  const dbConfig = databaseConfig(env.DATABASE_URL);
  if (!dbConfig) problems.push("DATABASE_URL");
  if (rpcUrls.length === 0 || !rpcUrls.every((url) => URL.canParse(url))) problems.push("QIE_RPC_URLS");
  const account = relayerAccount(env);
  if (!account) problems.push("RELAYER_PRIVATE_KEY");
  if (problems.length || !account || !dbConfig || !contracts.ok || !limits.ok) return off(problems);

  let db: Db;
  try {
    db = openDatabase({ ...dbConfig, max: POOL_MAX.relay }, log);
  } catch (error) {
    log("relay.db_config_failed", { cause: errorLabel(error) });
    return off(["DATABASE_URL"]);
  }

  const rpc = new RelayRpc(rpcUrls);
  const guard = new PgRelayGuard(db, limits.limits);
  const sender = new NonceManager({
    rpc,
    account,
    log,
    openRelays: () => guard.openRelays(),
    assertStore: () => guard.assertAvailable(),
  });
  const { forwarder, targets } = contracts.contracts;

  return {
    relay: createRelay({
      auth: auth.authenticator,
      guard,
      chain: new ForwarderChain(rpc, forwarder, account.address),
      sender,
      relayer: account.address,
      targets,
      log,
    }),
    problems: [],
    start: () => sender.start(),
    async stop() {
      await sender.stop();
      await db.close();
    },
  };
}

/** SPEC §11: the hot wallets are separate keys. Two nonce managers on one key would also collide. */
function relayerAccount(env: Env): PrivateKeyAccount | null {
  const key = normaliseKey(secret(env, "RELAYER_PRIVATE_KEY", 64) ?? undefined);
  if (!/^[0-9a-f]{64}$/.test(key)) return null;
  if (OTHER_KEYS.some((name) => normaliseKey(env[name]) === key)) return null;
  try {
    return privateKeyToAccount(`0x${key}`);
  } catch {
    return null; // not a valid scalar. The library's message could echo the key, so it's dropped.
  }
}
