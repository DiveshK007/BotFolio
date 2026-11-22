import type { ForwardRequest } from "@botfolio/shared";
import type { Address, Hex } from "viem";
import { RelayRefusal } from "./errors";

/** The biggest allowlisted call, executeApproved with a 65-byte runner signature, is under 400 bytes. */
export const MAX_CALLDATA_BYTES = 1024;

const UINT256_MAX = 2n ** 256n - 1n;
const UINT48_MAX = 2 ** 48 - 1;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const BYTES = new RegExp(`^0x(?:[0-9a-fA-F]{2}){0,${MAX_CALLDATA_BYTES}}$`);
const DECIMAL = /^(?:0|[1-9][0-9]{0,77})$/;

/**
 * Strict parse of RelayRequestBody. Hex is lowercased, so later comparisons can't be dodged with letter case.
 * viem accepts lowercase addresses.
 */
export function parseRelayBody(body: unknown): ForwardRequest {
  const r = asRecord(asRecord(body).request);
  const deadline = r.deadline;
  if (typeof deadline !== "number" || !Number.isInteger(deadline) || deadline < 0 || deadline > UINT48_MAX) {
    throw new RelayRefusal("BAD_REQUEST");
  }
  return {
    from: match(r.from, ADDRESS).toLowerCase() as Address,
    to: match(r.to, ADDRESS).toLowerCase() as Address,
    value: uint256(r.value),
    gas: uint256(r.gas),
    deadline,
    data: match(r.data, BYTES).toLowerCase() as Hex,
    signature: match(r.signature, SIGNATURE).toLowerCase() as Hex,
  };
}

/** The 4-byte selector, or null when there is none. */
export function selectorOf(data: Hex): Hex | null {
  return data.length >= 10 ? (data.slice(0, 10) as Hex) : null;
}

function asRecord(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new RelayRefusal("BAD_REQUEST");
  return v as Record<string, unknown>;
}

function match(v: unknown, pattern: RegExp): string {
  if (typeof v !== "string" || !pattern.test(v)) throw new RelayRefusal("BAD_REQUEST");
  return v;
}

function uint256(v: unknown): bigint {
  const n = BigInt(match(v, DECIMAL));
  if (n > UINT256_MAX) throw new RelayRefusal("BAD_REQUEST");
  return n;
}
