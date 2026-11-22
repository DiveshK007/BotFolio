export interface Log {
  info(event: string, fields?: object): void;
  warn(event: string, fields?: object): void;
}

// One JSON line per entry, so a hostile string can't forge a second line.
const line = (event: string, fields?: object) =>
  JSON.stringify({ event, ...fields }, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v));

export const consoleLog: Log = {
  info: (event, fields) => console.log(line(event, fields)),
  warn: (event, fields) => console.warn(line(event, fields)),
};

/**
 * What a log may say about an error: its code or its class, never the message. Postgres messages and details
 * quote the row they refused, which can hold the bot's secret Daily Call view. RPC messages quote the URL.
 */
export function errorLabel(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown";
  const { code, name } = error as { code?: unknown; name?: unknown };
  if (typeof code === "string" && /^\w{2,40}$/.test(code)) return code;
  return typeof name === "string" && /^\w{2,60}$/.test(name) ? name : "Error";
}
