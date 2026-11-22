export interface Log {
  info(message: string, fields?: object): void;
  warn(message: string, fields?: object): void;
}

// One line per entry. Fields are JSON, so a hostile string can't forge a second line; bigints print exactly.
const line = (message: string, fields?: object) => {
  if (!fields) return `[indexer] ${message}`;
  return `[indexer] ${message} ${JSON.stringify(fields, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v))}`;
};

export const consoleLog: Log = {
  info: (message, fields) => console.log(line(message, fields)),
  warn: (message, fields) => console.warn(line(message, fields)),
};
