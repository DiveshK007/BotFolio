import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { main, type Io } from "../src/main";

const SEASON = JSON.stringify({
  chain_id: 1990,
  ends_at: "2026-11-25T16:00:00.000Z",
  from_block: "1",
  kind: "sprint",
  paper_ledger: `0x${"22".repeat(20)}`,
  season: 0,
  season_ledger: `0x${"11".repeat(20)}`,
  starts_at: "2026-11-23T18:30:00.000Z",
  trust_rules_version: "trust-v1-sprint",
  type: "season",
});

function io(files: Record<string, string>) {
  const lines: string[] = [];
  const value: Io = {
    out: (line) => void lines.push(line),
    fetchText: async (url) => files[url] ?? Promise.reject(new Error("404")),
    readText: async (path) => files[path] ?? Promise.reject(new Error("ENOENT")),
    client: () => ({}) as PublicClient,
  };
  return { value, lines };
}

describe("botfolio-replay", () => {
  it("passes a good file offline", async () => {
    const { value, lines } = io({ "season-0.jsonl": `${SEASON}\n` });
    expect(await main(["season-0.jsonl", "--offline"], value)).toBe(0);
    expect(lines.join("\n")).toContain("Season 0: 1 lines");
  });

  it("fails a file that isn't canonical", async () => {
    const reordered = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(SEASON)).reverse()));
    const { value, lines } = io({ "https://x.example/s.jsonl": `${reordered}\n` });
    expect(await main(["https://x.example/s.jsonl", "--offline"], value)).toBe(1);
    expect(lines.join("\n")).toContain("not canonical JSON");
  });

  it("explains its usage", async () => {
    const { value, lines } = io({});
    expect(await main([], value)).toBe(2);
    expect(await main(["3"], value)).toBe(2);
    expect(lines.join("\n")).toContain("--ledger");
  });

  it("says when a file can't be read", async () => {
    const { value, lines } = io({});
    expect(await main(["missing.jsonl", "--offline"], value)).toBe(2);
    expect(lines.at(-1)).toContain("Couldn't read missing.jsonl");
  });
});
