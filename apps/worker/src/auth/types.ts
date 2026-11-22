import type { IncomingHttpHeaders } from "node:http";
import type { RelayAuthKind } from "@botfolio/shared";
import type { Address } from "viem";

/** Who is calling, as proven server-side. Never built from fields in the request body. */
export interface Identity {
  kind: RelayAuthKind;
  /** Lowercase. A Privy user can have several wallets; a SIWE login has exactly one. */
  wallets: Address[];
  /** Privy DID, absent for SIWE. */
  privyDid?: string;
}

export interface Authenticator {
  /** null = missing, invalid or expired credentials. Throws when they could not be checked. */
  authenticate(headers: IncomingHttpHeaders): Promise<Identity | null>;
}
