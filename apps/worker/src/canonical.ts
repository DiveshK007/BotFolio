import { keccak256, stringToBytes, type Hex } from "viem";

/**
 * Canonical JSON (SPEC §6.5): sorted keys, no whitespace, so the same value always hashes the same.
 * bigint → decimal string. Built by hand because JSON.stringify moves integer-like keys to the front.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "bigint":
      return `"${value}"`;
    case "boolean":
      return String(value);
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new Error(`canonicalJson: ${value} is not JSON`);
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new Error("canonicalJson: only plain objects");
      const fields = Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
      return `{${fields.join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: can't encode ${typeof value}`);
  }
}

// stringToBytes, not toBytes: toBytes would read a string starting "0x" as hex.
export function hashText(text: string): Hex {
  return keccak256(stringToBytes(text));
}

/** keccak256 over canonical JSON: `input_hash`, `output_hash`, persona hash. */
export function hashJson(value: unknown): Hex {
  return hashText(canonicalJson(value));
}
