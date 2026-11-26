import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, stringToBytes, type Hex } from "viem";
import { merkleRoot, raceFromLines, seasonRace, verifiedLines } from "./replay";

const START = 1_000_000_000_000n;
const mark = (bot: string, t: string, v: string) => JSON.stringify({ bot_id: bot, cash_e8: "0", holdings: [], slot_id: "1", slot_time: t, type: "mark", value_e8: v });
const lines = [
  JSON.stringify({ season: 1, type: "season" }),
  mark("7", "2026-11-26T03:30:00.000Z", "1010000000000"),
  mark("8", "2026-11-26T03:30:00.000Z", "990000000000"),
  mark("7", "2026-11-26T07:30:00.000Z", "1020000000000"),
  mark("8", "2026-11-26T07:30:00.000Z", "1050000000000"),
];
const text = lines.join("\n") + "\n";
const root = merkleRoot(lines.map(l => keccak256(stringToBytes(l))));
const names = new Map([["7", { name: "AlphaWolf", isHouse: false }]]);
const A = `0x${"1".repeat(40)}`, B = `0x${"2".repeat(40)}`;

describe("season replay file", () => {
  it("only accepts a file that hashes to the on-chain root", () => {
    expect(verifiedLines(text, root)).toHaveLength(5);
    expect(verifiedLines(text.replace("1050000000000", "1990000000000"), root)).toBeNull();
  });
  it("builds one point per mark, ranked by the final mark, IST labels", () => {
    const r = raceFromLines(lines, START, names)!;
    expect(r.series.map(s => [s.id, s.name, s.points])).toEqual([["8", "Bot #8", [-1, 5]], ["7", "AlphaWolf", [1, 2]]]);
    expect(r.labels[0]).toMatch(/^Open · /);
    expect(r.labels[1]).toMatch(/^Close · .*13:00/);
  });
  it("reads dataURI from SeasonLedger and falls back (null) on a bad file or missing addresses", async () => {
    const seasonWord = (closed: boolean) => encodeAbiParameters(
      [{ type: "uint64" }, { type: "uint64" }, { type: "bytes32" }, { type: "string" }, { type: "bool" }],
      [0n, 0n, root, "https://files.example/season-1.jsonl", closed],
    );
    const call = async (to: string, data: Hex): Promise<Hex> => (to === B ? encodeAbiParameters([{ type: "uint256" }], [START]) : data.length > 0 ? seasonWord(true) : "0x");
    const ok = await seasonRace(1, names, { seasonLedger: A, paperLedger: B, call, download: async () => text });
    expect(ok?.season).toBe(1);
    expect(ok?.series).toHaveLength(2);
    expect(await seasonRace(1, names, { seasonLedger: A, paperLedger: B, call, download: async () => "tampered\n" })).toBeNull();
    expect(await seasonRace(1, names, { call, download: async () => text, seasonLedger: "", paperLedger: "" })).toBeNull();
    const open = async (to: string): Promise<Hex> => (to === B ? encodeAbiParameters([{ type: "uint256" }], [START]) : seasonWord(false));
    expect(await seasonRace(1, names, { seasonLedger: A, paperLedger: B, call: open, download: async () => text })).toBeNull();
  });
});
