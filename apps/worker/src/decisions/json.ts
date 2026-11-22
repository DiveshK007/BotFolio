import { canonicalJson } from "../canonical";

/*
 * jsonb refuses NUL and lone surrogates, and model output can contain both. A refused write would lose the
 * decision, and changing the text would break its hash. So:
 *   - values that are hashed (input, raw output) are stored losslessly, wrapped as text when Postgres can't take them;
 *   - public display values (gate_result, reason, roast) get U+FFFD instead.
 */

const WRAPPED = "$json";
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function pgSafeText(text: string): string {
  return text.replaceAll("\u0000", "�").replace(LONE_SURROGATE, "�");
}

function needsWrapping(value: unknown): boolean {
  if (typeof value === "string") return pgSafeText(value) !== value;
  if (Array.isArray(value)) return value.some(needsWrapping);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, v]) => pgSafeText(key) !== key || needsWrapping(v));
}

/** A jsonb parameter for a value that is hashed. `readExact` gives back a value with the same hash. */
export function exactJsonb(value: unknown): string {
  const text = canonicalJson(value);
  // A value that looks like our wrapper is wrapped too, so reading is never ambiguous.
  const lookalike = typeof value === "object" && value !== null && WRAPPED in value;
  return lookalike || needsWrapping(value) ? JSON.stringify({ [WRAPPED]: text }) : text;
}

/** Undoes `exactJsonb` on a value read back from jsonb. */
export function readExact(stored: unknown): unknown {
  if (typeof stored === "object" && stored !== null && Object.keys(stored).join() === WRAPPED) {
    const text = (stored as Record<string, unknown>)[WRAPPED];
    if (typeof text === "string") return JSON.parse(text);
  }
  return stored;
}

/** The display form: bigint → decimal string, text Postgres can't hold → U+FFFD. */
export function publicJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return pgSafeText(value);
  if (Array.isArray(value)) return value.map(publicJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([key, v]) => [pgSafeText(key), publicJson(v)]),
  );
}
