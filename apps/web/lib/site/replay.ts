/**
 * Race replay from the real season replay file (SPEC §6.5, HANDOFF follow-up #3).
 * The file's URL comes from the chain, not from us: SeasonLedger.seasons(n).dataURI. We download it, check every
 * line's keccak256 rolls up to the on-chain dataRoot, and only then draw it. Anything missing or off → the caller
 * keeps the labelled EXAMPLE replay. Return % at each mark = value / PaperLedger.START_CASH_E8 − 1.
 */
import { concat, decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, stringToBytes, type Hex } from "viem";
import type { RaceSeries } from "@/components/site/extras";
import { rpc } from "./oracle";

const SEASON_ABI = parseAbi(["function seasons(uint32 n) view returns (uint64 start, uint64 end, bytes32 dataRoot, string dataURI, bool closed)"]);
const START_ABI = parseAbi(["function START_CASH_E8() view returns (uint256)"]);
const ADDR = /^0x[0-9a-fA-F]{40}$/;
/** Most bots the replay draws. */
export const RACE_BOTS = 10;

/* Same tree as apps/worker/src/season/merkle.ts (OpenZeppelin MerkleProof: sorted pairs, odd node moves up). */
const hashPair = (a: Hex, b: Hex): Hex => (a.toLowerCase() < b.toLowerCase() ? keccak256(concat([a, b])) : keccak256(concat([b, a])));
export function merkleRoot(leaves: readonly Hex[]): Hex {
  if (leaves.length === 0) throw new Error("no leaves");
  let level = [...leaves];
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? hashPair(level[i]!, level[i + 1]!) : level[i]!);
    level = next;
  }
  return level[0]!;
}

/** The file's lines, only if they hash to `root`. */
export function verifiedLines(text: string, root: Hex): string[] | null {
  const lines = text.split("\n").filter(l => l.length > 0);
  if (!lines.length) return null;
  return merkleRoot(lines.map(l => keccak256(stringToBytes(l)))).toLowerCase() === root.toLowerCase() ? lines : null;
}

const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export interface Race { series: RaceSeries[]; labels: string[] }

/** Builds the race from `mark` lines: one point per slot, the top RACE_BOTS by final value. */
export function raceFromLines(lines: string[], startCashE8: bigint, names: Map<string, { name: string; isHouse: boolean }>): Race | null {
  if (startCashE8 <= 0n) return null;
  const marks: { bot: string; t: string; v: bigint }[] = [];
  for (const l of lines) {
    let j: unknown;
    try { j = JSON.parse(l); } catch { return null; }
    const m = j as { type?: unknown; bot_id?: unknown; slot_time?: unknown; value_e8?: unknown };
    if (m.type !== "mark") continue;
    if (typeof m.bot_id !== "string" || typeof m.slot_time !== "string" || typeof m.value_e8 !== "string" || !/^\d+$/.test(m.value_e8)) return null;
    marks.push({ bot: m.bot_id, t: m.slot_time, v: BigInt(m.value_e8) });
  }
  if (!marks.length) return null;
  const slots = [...new Set(marks.map(m => m.t))].sort((a, b) => Date.parse(a) - Date.parse(b));
  const byBot = new Map<string, Map<string, bigint>>();
  for (const m of marks) (byBot.get(m.bot) ?? byBot.set(m.bot, new Map()).get(m.bot)!).set(m.t, m.v);
  // Basis points from bigint first, so big E8 numbers don't lose precision.
  const pct = (v: bigint) => Number(((v - startCashE8) * 10000n) / startCashE8) / 100;
  const series: RaceSeries[] = [...byBot.entries()].map(([id, vals]) => {
    let last = 0;
    const points = slots.map(t => { const v = vals.get(t); if (v !== undefined) last = pct(v); return last; });
    const who = names.get(id);
    return { id, name: who?.name ?? `Bot #${id}`, isHouse: who?.isHouse ?? false, points };
  });
  series.sort((a, b) => (b.points.at(-1) ?? 0) - (a.points.at(-1) ?? 0));
  const labels = slots.map((t, i) => `${i === 0 ? "Open · " : i === slots.length - 1 ? "Close · " : ""}${IST.format(new Date(t))}`);
  return { series: series.slice(0, RACE_BOTS), labels };
}

type Call = (to: string, data: Hex) => Promise<Hex>;
const ethCall: Call = (to, data) => rpc<Hex>("eth_call", [{ to, data }, "latest"], 300);

/** The newest closed season at or below `season` (looks back 3), read from chain, its file checked against the root. */
export async function seasonRace(
  season: number,
  names: Map<string, { name: string; isHouse: boolean }>,
  opts: { seasonLedger?: string; paperLedger?: string; call?: Call; download?: (url: string) => Promise<string> } = {},
): Promise<(Race & { season: number }) | null> {
  const seasonLedger = opts.seasonLedger ?? process.env.NEXT_PUBLIC_SEASON_LEDGER_ADDRESS;
  const paperLedger = opts.paperLedger ?? process.env.NEXT_PUBLIC_PAPER_LEDGER_ADDRESS;
  if (!seasonLedger || !ADDR.test(seasonLedger) || !paperLedger || !ADDR.test(paperLedger)) return null;
  const call = opts.call ?? ethCall;
  const download = opts.download ?? (async (url: string) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000), next: { revalidate: 3600 } } as RequestInit);
    if (!r.ok) throw new Error(String(r.status));
    return r.text();
  });
  try {
    const startCash = decodeFunctionResult({ abi: START_ABI, functionName: "START_CASH_E8", data: await call(paperLedger, encodeFunctionData({ abi: START_ABI, functionName: "START_CASH_E8" })) });
    for (let n = season; n >= Math.max(1, season - 3); n--) {
      const [, , dataRoot, dataURI, closed] = decodeFunctionResult({ abi: SEASON_ABI, functionName: "seasons", data: await call(seasonLedger, encodeFunctionData({ abi: SEASON_ABI, functionName: "seasons", args: [n] })) });
      if (!closed || !/^https:\/\//.test(dataURI)) continue;
      const lines = verifiedLines(await download(dataURI), dataRoot);
      if (!lines) return null; // a file that doesn't match its root is never drawn
      const race = raceFromLines(lines, startCash, names);
      return race ? { ...race, season: n } : null;
    }
    return null;
  } catch {
    return null;
  }
}
