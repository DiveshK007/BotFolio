import { createAuthenticator } from "./authenticator";
import { secret, type Env } from "./env";
import { RelayJwt } from "./jwt";
import { NonceService } from "./nonce";
import { PrivyVerifier } from "./privy";
import type { AuthRouteOptions } from "./routes";
import type { Authenticator } from "./types";

export interface AuthSetup {
  authenticator: Authenticator;
  siwe: AuthRouteOptions["siwe"];
  /** For deleting a Privy user (#174); null when Privy isn't configured. */
  privy: PrivyVerifier | null;
  /** Names of missing or placeholder variables. The relay doesn't start while there are any. */
  problems: string[];
}

export function setUpAuth(env: Env, opts: { fetch?: typeof fetch; now?: () => number } = {}): AuthSetup {
  const problems: string[] = [];
  const need = (name: string, value: string | null) => {
    if (value === null) problems.push(name);
    return value;
  };

  const jwtSecret = need("RELAY_JWT_SECRET", secret(env, "RELAY_JWT_SECRET", 32));
  const rawDomain = secret(env, "SIWE_DOMAIN", 1);
  // An authority (host or host:port), not a URL.
  const domain = need("SIWE_DOMAIN", rawDomain && /^[a-z0-9.-]+(:\d{1,5})?$/.test(rawDomain) ? rawDomain : null);

  const rawAppId = secret(env, "NEXT_PUBLIC_PRIVY_APP_ID", 8);
  const appId = need("NEXT_PUBLIC_PRIVY_APP_ID", rawAppId && /^[A-Za-z0-9]{8,64}$/.test(rawAppId) ? rawAppId : null);
  const appSecret = need("PRIVY_APP_SECRET", secret(env, "PRIVY_APP_SECRET", 16));

  const jwt = jwtSecret ? new RelayJwt(jwtSecret, opts.now) : null;
  const privy = appId && appSecret ? new PrivyVerifier({ appId, appSecret, ...opts }) : null;

  return {
    authenticator: createAuthenticator({ jwt, privy }),
    siwe: jwt && domain ? { domain, jwt, nonces: new NonceService(opts.now) } : null,
    privy,
    problems,
  };
}
