import type { Log } from "../../../src/scheduler/log";

export function memoryLog(): Log & { lines: string[]; text(): string } {
  const lines: string[] = [];
  const write = (event: string, fields?: object) =>
    void lines.push(JSON.stringify({ event, ...fields }, (_key, v: unknown) => (typeof v === "bigint" ? String(v) : v)));
  return { lines, info: write, warn: write, text: () => lines.join("\n") };
}
