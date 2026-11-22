// TODO(#33): replace with @botfolio/shared once packages/shared/src/relay.ts merges.
// The minimum S2 needs, copied from the proposal on branch b/33-relay-ts. UNVERIFIED until that is frozen.
import type { Address, Hex } from "viem";

export const RELAY_PATH = "/relay";

/** SPEC §11: Privy session token or SIWE JWT. This header says which one the bearer token is. */
export type RelayAuthKind = "privy" | "siwe";
export const RELAY_AUTH_KIND_HEADER = "x-botfolio-auth";

/** SPEC §11 relayer limits: gas ≤ 300k, deadline ≤ 10 min. */
export const RELAY_MAX_GAS = 300_000n;
export const RELAY_MAX_DEADLINE_SECONDS = 600;

/** OZ 5.0.2 ERC2771Forwarder typed data (SPEC §4.1). */
export const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
} as const;

export interface ForwardRequestMessage {
  from: Address;
  to: Address;
  value: bigint;
  gas: bigint;
  nonce: bigint;
  deadline: number;
  data: Hex;
}

export interface ForwardRequestTypedData {
  domain: { name: "BotFolio"; version: "1"; chainId: number; verifyingContract: Address };
  types: typeof FORWARD_REQUEST_TYPES;
  primaryType: "ForwardRequest";
  message: ForwardRequestMessage;
}

/** On the wire: no nonce (the forwarder reads it), uint256 as decimal strings. */
export interface ForwardRequestJson {
  from: Address;
  to: Address;
  value: string;
  gas: string;
  deadline: number;
  data: Hex;
  signature: Hex;
}
