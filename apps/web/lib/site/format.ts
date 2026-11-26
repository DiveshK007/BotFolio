import type { AssetId } from "@botfolio/shared";

/** Why the explorer shows 1,078 where the app shows $100,000 (START_CASH_E8 = 107800000000, decisions.md Nov 26). */
export const START_CASH_LINE = "On chain every bot starts with 1,078 play units (PaperLedger.START_CASH_E8); the app scales that to $100,000.";

/** Play $: 103420 → $103,420. Play-money display unit only. */
export const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export const pct = (n: number, d = 2) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(d) + "%";
export const arrow = (n: number) => (n > 0 ? "▲" : n < 0 ? "▼" : "•");
export const upDown = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "muted");

/** Oracle answers are 8-decimal fixed point (SPEC §0.2). */
export function e8ToNumber(e8: string | bigint): number {
  const v = typeof e8 === "bigint" ? e8 : BigInt(e8);
  return Number(v / 10n ** 4n) / 1e4; // keep 4 dp of precision before float
}
export const usd = (v: number, d = 2) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const priceDecimals = (a: AssetId) => (a === "XRP" ? 4 : 2);
export const assetLabel = (a: AssetId | "CASH") => (a === "GOLD" ? "Gold" : a === "CASH" ? "Cash" : a);

export const short = (h: string) => h.slice(0, 6) + "…" + h.slice(-4);

/** Times are always shown in IST with the zone written out (brief, Phase 4). */
export function istTime(iso: string, withDate = true) {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    ...(withDate ? { month: "short", day: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(d) + " IST";
}

/** Price-age rule, SPEC §5.7: <60 min muted, ≥60 min amber, past max age grey "holding". */
export type AgeTone = "muted" | "amber" | "grey";
export const MAX_AGE_MIN: Record<AssetId, number> = { BTC: 30, ETH: 30, SOL: 30, XRP: 30, GOLD: 360 };
export function priceAge(asset: AssetId, ageMin: number): { tone: AgeTone; text: string } {
  if (ageMin > MAX_AGE_MIN[asset]) return { tone: "grey", text: "Holding — price too old" };
  if (ageMin >= 60) return { tone: "amber", text: `▲ ${asset === "GOLD" ? "Gold" : asset} price ${Math.floor(ageMin / 60)}h old` };
  return { tone: "muted", text: `${Math.max(0, Math.round(ageMin))}m old` };
}

/** Deterministic mascot colour for bots without one. */
const PALETTE = ["#2B50FF", "#E0A400", "#0E9F8E", "#D9480F", "#8E6CCB", "#3E8E41", "#B0643A", "#2B6CD9"];
export const botColor = (id: number, c?: string) => c ?? PALETTE[id % PALETTE.length];
