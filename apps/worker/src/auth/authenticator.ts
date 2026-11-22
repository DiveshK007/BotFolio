import { RELAY_AUTH_KIND_HEADER } from "@botfolio/shared";
import { InternalFailure } from "./log";
import type { RelayJwt } from "./jwt";
import type { PrivyVerifier } from "./privy";
import type { Authenticator } from "./types";

const BEARER = /^Bearer ([A-Za-z0-9_-]{1,4096}\.[A-Za-z0-9_-]{1,4096}\.[A-Za-z0-9_-]{1,1024})$/;

/** The header says which verifier to use. A token is never tried against the other one. */
export function createAuthenticator(verifiers: { jwt: RelayJwt | null; privy: PrivyVerifier | null }): Authenticator {
  return {
    async authenticate(headers) {
      const token = BEARER.exec(headers.authorization ?? "")?.[1];
      if (!token) return null;
      switch (headers[RELAY_AUTH_KIND_HEADER]) {
        case "siwe": {
          if (!verifiers.jwt) throw new InternalFailure("siwe_not_configured");
          const wallet = await verifiers.jwt.verify(token);
          return wallet && { kind: "siwe", wallets: [wallet] };
        }
        case "privy": {
          if (!verifiers.privy) throw new InternalFailure("privy_not_configured");
          const user = await verifiers.privy.verify(token);
          return user && { kind: "privy", wallets: user.wallets, privyDid: user.did };
        }
        default:
          return null;
      }
    },
  };
}
