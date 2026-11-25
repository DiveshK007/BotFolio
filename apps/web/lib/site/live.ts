/**
 * Website data with honest fallbacks. LIVE comes from the worker's public reads (same endpoints as the app);
 * when the worker isn't configured or doesn't answer, sections use EXAMPLE data and must say so.
 * Names are LLM output from user text (#159): render as JSX text only.
 */
import { getWorkerUrl } from "@/lib/config";
import { fetchLeaderboards, type Leaderboards } from "@/lib/leaderboards";
import type { Racer } from "@/components/site/arcade";
import type { DexBot, RaceSeries } from "@/components/site/extras";
import { SAMPLE_BOTS } from "./sample";
import { seasonRace } from "./replay";

export type Live<T> = { example: boolean; data: T };

async function boards(): Promise<Leaderboards | null> {
  const base = getWorkerUrl(); if (!base) return null;
  try { return (await fetchLeaderboards(base, null, AbortSignal.timeout(8000))).boards; } catch { return null; }
}

const EX_RACERS: Racer[] = [
  { ...SAMPLE_BOTS[3], id: 3, ret: 4.2, vol: 0.55, lines: ["BTC is moving. So am I.", "Chased it. It ran the other way."] },
  { ...SAMPLE_BOTS[12], id: 12, owner: SAMPLE_BOTS[12].ownerWallet, ret: 3.42, vol: 0.25, lines: ["A little more gold. Calmly.", "Holding. Patience is a strategy."] },
  { ...SAMPLE_BOTS[1], id: 1, ret: 1.85, vol: 0.12, lines: ["Rebalanced to 20% each. Boring. Correct.", "Rebalanced to 20% each. Boring. Correct."] },
  { ...SAMPLE_BOTS[2], id: 2, ret: 0.95, vol: 0.18, lines: ["More gold. Always more gold.", "Gold dipped. Granny is unbothered."] },
  { ...SAMPLE_BOTS[7], id: 7, owner: SAMPLE_BOTS[7].ownerWallet, ret: -12.4, vol: 0.9, lines: ["35% in SOL. Inside my 40% cap. Barely.", "Bought the top like it was on sale."] },
];
export async function arenaRacers(): Promise<Live<Racer[]>> {
  const b = await boards();
  if (!b || b.topReturns.length === 0) return { example: true, data: EX_RACERS };
  return { example: false, data: b.topReturns.slice(0, 6).map(e => ({ id: e.botId, name: e.name, isHouse: e.isHouse, ret: e.returnBps / 100, vol: 0, lines: [e.returnBps >= 0 ? "Up this season." : "Down this season.", "Down this season."] })) };
}

export async function botOfWeek(): Promise<Live<{ id: string; name: string; line: string; stat: string }>> {
  const b = await boards();
  const t = b?.mostTrusted.find(e => !e.isHouse);
  if (!t) return { example: true, data: { id: "12", name: "Gold Guru", line: "Steadiest climb of Season 1, and it never once broke its own rules. Its owner coached it \"too timid\" twice and it listened.", stat: "▲ +3.42% · trust 684" } };
  return { example: false, data: { id: t.botId, name: t.name, line: `Most trusted bot of season ${b!.trustSeason ?? b!.season}.`, stat: `trust ${t.total}/1000` } };
}

const DEX_NAMES = ["Paneer Bull", "Monsoon Mode", "Filter Kaapi", "Auto Rickshaw", "Dosa Dynamo", "Biryani Bear", "Lassi Lion", "Metro Mouse", "Cricket Chirp", "Rangoli Robo", "Pani Puri Pro", "Idli Ion", "Mango Mode", "Tiffin Titan", "Jugaad Jet", "Vada Vortex", "Kulfi Kid", "Masala Mech", "Bus Stop Bot", "Sambar Sage"];
const h = (s: string) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
export async function dexBots(): Promise<Live<DexBot[]>> {
  const b = await boards();
  if (b) {
    const seen = new Map<string, DexBot>();
    for (const e of [...b.topReturns, ...b.mostTrusted, ...b.bestRiskAdjusted, ...b.coachVsBot]) if (!seen.has(e.botId)) seen.set(e.botId, { id: e.botId, name: e.name, isHouse: e.isHouse, returnPct: "returnBps" in e ? (e as { returnBps: number }).returnBps / 100 : null });
    if (seen.size) return { example: false, data: [...seen.values()] };
  }
  const base = Object.values(SAMPLE_BOTS).map(x => ({ id: String(x.id), name: x.name, persona: x.personaText, isHouse: x.isHouse, returnPct: null, version: x.id === 12 ? 2 : 1 }));
  return { example: true, data: [...base, ...DEX_NAMES.map((n, i) => ({ id: String(100 + i), name: n, returnPct: ((h(n) % 1600) - 600) / 100, version: h(n + "v") % 3 === 0 ? 2 : 1 }))] };
}

export const RACE_LABELS = ["Open · Nov 26 00:00", "Nov 26 09:00", "Nov 26 13:00", "Nov 26 17:00", "Nov 26 21:00", "Nov 27 09:00", "Nov 27 13:00", "Nov 27 17:00", "Close · Nov 27 21:00"];
/**
 * Real replay when a season has closed on chain and its file checks out against the data root (lib/site/replay.ts),
 * else the labelled EXAMPLE race. `season` = the one the page shows; null = the worker's current season.
 */
export async function seasonReplay(season: number | null): Promise<Live<{ series: RaceSeries[]; labels: string[] }> & { season?: number }> {
  const base = getWorkerUrl();
  if (base) {
    try {
      const a = await fetchLeaderboards(base, season, AbortSignal.timeout(8000));
      const b = a.boards;
      const names = new Map<string, { name: string; isHouse: boolean }>();
      for (const e of [...b.topReturns, ...b.mostTrusted, ...b.bestRiskAdjusted, ...b.coachVsBot]) names.set(e.botId, { name: e.name, isHouse: e.isHouse });
      const race = await seasonRace(season ?? a.currentSeason, names);
      if (race) return { example: false, data: { series: race.series, labels: race.labels }, season: race.season };
    } catch { /* fall through to the labelled example */ }
  }
  return { example: true, data: { series: raceSeries().data, labels: RACE_LABELS } };
}

/** EXAMPLE race, labelled on the page. */
export function raceSeries(): Live<RaceSeries[]> {
  const finals: [number, number][] = [[21, 5.1], [3, 4.2], [12, 3.42], [58, 2.3], [1, 1.85], [41, 1.2], [2, 0.95], [33, 0.6], [52, -0.8], [7, -12.4]];
  return { example: true, data: finals.map(([id, fin]) => { const bot = SAMPLE_BOTS[id]; let s = h(bot.name); const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; const pts = [0]; for (let i = 1; i < 8; i++) pts.push(fin * (i / 8) + (r() - 0.5) * Math.abs(fin + 2) * 0.6); pts.push(fin); return { id: String(id), name: bot.name, isHouse: bot.isHouse, points: pts }; }) };
}
