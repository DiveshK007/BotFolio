import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { secret, type Env } from "../auth/env";

/** SPEC §11: each of these is a separate key. */
const WALLET_KEYS = ["RELAYER_PRIVATE_KEY", "RUNNER_PRIVATE_KEY", "COMMITTER_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"] as const;
export type SystemKey = "RUNNER_PRIVATE_KEY" | "COMMITTER_PRIVATE_KEY";

const normalise = (key: string | undefined) => key?.trim().toLowerCase().replace(/^0x/, "") ?? "";

/** The wallet, or null if the key is missing, a placeholder, malformed or shared with another wallet. */
export function systemAccount(env: Env, name: SystemKey): PrivateKeyAccount | null {
  const key = normalise(secret(env, name, 64) ?? undefined);
  if (!/^[0-9a-f]{64}$/.test(key)) return null;
  if (WALLET_KEYS.some((other) => other !== name && normalise(env[other]) === key)) return null;
  try {
    return privateKeyToAccount(`0x${key}`);
  } catch {
    return null; // not a valid scalar. The library's message could echo the key, so it's dropped.
  }
}
