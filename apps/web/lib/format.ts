import { ASSETS, type AssetId } from "@botfolio/shared";

/**
 * Display rules shared by every screen.
 * - $ rule: SPEC §3. On-chain values are play USDT with 8 decimals; the $ figure is a display unit only.
 * - Price age: SPEC §5.7. Mandatory wherever a price or a mark is shown.
 */

/** The display $ every bot starts with (SPEC §1: $100,000 play capital). */
export const START_DISPLAY = 100_000;

/**
 * SPEC §3: display = 100000 × value / startValue (exact, deterministic).
 * Done in bigint so the result doesn't depend on float rounding of 8-decimal values.
 * Returns whole dollars, rounded half away from zero.
 */
export function displayMoney(valueE8: bigint, startValueE8: bigint): number {
  if (startValueE8 <= 0n) throw new RangeError("startValueE8 must be > 0");
  const num = BigInt(START_DISPLAY) * valueE8;
  const q = num / startValueE8;
  const r = num % startValueE8;
  const twiceR = (r < 0n ? -r : r) * 2n;
  const rounded = twiceR >= startValueE8 ? q + (num < 0n ? -1n : 1n) : q;
  return Number(rounded);
}

/** $ change relative to the start: same rule applied to (value − start). */
export const displayMoneyDelta = (valueE8: bigint, startValueE8: bigint) =>
  displayMoney(valueE8 - startValueE8, startValueE8);

/** Play $: 103420 → "$103,420", −12400 → "−$12,400". */
export function formatMoney(dollars: number, opts: { signed?: boolean } = {}): string {
  const abs = Math.abs(Math.round(dollars)).toLocaleString("en-US");
  if (dollars < 0) return `−$${abs}`;
  if (opts.signed && dollars > 0) return `+$${abs}`;
  return `$${abs}`;
}

/** 8-decimal fixed point → display string, e.g. 6392295000000n → "63,922.95". */
export function formatE8(e8: bigint, decimals = 2): string {
  const neg = e8 < 0n;
  const abs = neg ? -e8 : e8;
  const scale = 10n ** BigInt(8 - decimals);
  const rounded = (abs + scale / 2n) / scale; // value × 10^decimals
  const unit = 10n ** BigInt(decimals);
  const whole = (rounded / unit).toLocaleString("en-US");
  const frac = decimals > 0 ? "." + (rounded % unit).toString().padStart(decimals, "0") : "";
  return (neg ? "−" : "") + whole + frac;
}

/** Tooltip for every $ figure (SPEC §3): the exact on-chain amount behind the scaled display. */
export const moneyTooltip = (valueE8: bigint) =>
  `On chain: ${formatE8(valueE8)} play USDT, scaled so every bot starts at $100,000`;

// ---------------------------------------------------------------------------
// Price age (SPEC §5.7)
// ---------------------------------------------------------------------------

export type PriceAgeTone = "muted" | "amber" | "grey";
export interface PriceAgeLabel {
  tone: PriceAgeTone;
  text: string;
  /** true once past the asset's max age: the bot holds, no trade (SPEC §5.4). */
  stale: boolean;
}

const maxAgeSeconds = (asset: AssetId): number => {
  const a = ASSETS.find((x) => x.id === asset);
  if (!a) throw new RangeError(`unknown asset ${asset}`);
  return a.maxAgeSeconds; // 1800 s crypto, 21600 s gold (SPEC §0.2 / §5.3)
};

export const assetName = (asset: AssetId) => ASSETS.find((x) => x.id === asset)?.label ?? asset;

/**
 * SPEC §5.7:
 * - beyond the asset's limit → "Holding — price too old" (grey, no trade)
 * - ≥ 60 min → "Gold price 3h old" (amber)
 * - < 60 min → "Xm old" (muted)
 * Crypto's limit is 30 min, so crypto goes straight from muted to grey; only gold ever shows amber.
 */
export function priceAge(asset: AssetId, updatedAtSec: number, nowMs: number): PriceAgeLabel {
  const ageSec = Math.max(0, Math.floor(nowMs / 1000) - updatedAtSec);
  if (ageSec > maxAgeSeconds(asset)) return { tone: "grey", text: "Holding — price too old", stale: true };
  const ageMin = Math.floor(ageSec / 60);
  if (ageMin >= 60) return { tone: "amber", text: `${assetName(asset)} price ${Math.floor(ageMin / 60)}h old`, stale: false };
  return { tone: "muted", text: `${ageMin}m old`, stale: false };
}

// ---------------------------------------------------------------------------
// Hashes and addresses
// ---------------------------------------------------------------------------

export const isTxHash = (h: string): h is `0x${string}` => /^0x[0-9a-fA-F]{64}$/.test(h);
export const isAddress = (a: string): a is `0x${string}` => /^0x[0-9a-fA-F]{40}$/.test(a);
export const shortHex = (h: string) => (h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h);
