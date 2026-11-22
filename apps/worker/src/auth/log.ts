export type Log = (event: string, fields?: Record<string, string | number | boolean | null | undefined>) => void;

/**
 * An internal failure whose `reason` is one of our own fixed identifiers, so it is safe to log.
 * Anything from an RPC, Privy or Postgres error message is never logged: those can contain URLs and keys.
 */
export class InternalFailure extends Error {
  override name = "InternalFailure";
  constructor(readonly reason: string) {
    super(reason);
  }
}

export const consoleLog: Log = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));

/** The loggable part of an unknown error: class name and code, never message or stack. */
export function errorLabel(error: unknown): string {
  if (error instanceof InternalFailure) return error.reason;
  if (!(error instanceof Error)) return "unknown";
  const code = (error as { code?: unknown }).code;
  const clean = (v: unknown) => (typeof v === "string" && /^[\w-]{1,40}$/.test(v) ? v : "");
  return [clean(error.name), clean(code)].filter(Boolean).join(":") || "Error";
}
