import type { AssetId } from "@botfolio/shared";
import { REASON_TAGS } from "../decision/schema";

/*
 * Trust score factors (SPEC §7, trust-v1 and trust-v1-sprint). Each is an integer 0–250, floored. The two versions
 * score the same way; they differ only in the provisional threshold, which the season row carries.
 *
 * Choices the spec leaves open are spelled out here and in docs/decisions.md (Nov 23). Change them only by
 * publishing a new rules version.
 */

export const FACTOR_MAX = 250;

/** F1: share of proposed BUY/SELL actions the gate passed unclipped. Stale and paused drops don't count. */
export function fRules(proposed: number, penalised: number): number {
  const of = Math.max(1, proposed);
  return Math.floor((FACTOR_MAX * (of - Math.min(penalised, of))) / of);
}

/**
 * F2: `250 × max(0, 1 − maxDD / 0.30)` over the value history, in exact integer maths. `values` starts with the
 * start cash (every bot is created with it), then every slot mark in time order.
 */
export function fDrawdown(values: readonly bigint[]): number {
  let peak = 0n;
  // The worst drop as a fraction drop/top, compared by cross-multiplying.
  let drop = 0n;
  let top = 1n;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0n && (peak - v) * top > drop * peak) {
      drop = peak - v;
      top = peak;
    }
  }
  // 1 − (drop/top)/0.3 = (3·top − 10·drop) / (3·top)
  const left = 3n * top - 10n * drop;
  return left <= 0n ? 0 : Number((BigInt(FACTOR_MAX) * left) / (3n * top));
}

const MIN_DAILY_RETURNS = 3;

/** F3: `250 × max(0, 1 − σ_daily / 0.04)`, σ the population standard deviation; 125 with fewer than 3 returns. */
export function fConsistency(dailyReturns: readonly number[]): number {
  const n = dailyReturns.length;
  if (n < MIN_DAILY_RETURNS) return FACTOR_MAX / 2;
  const mean = dailyReturns.reduce((a, r) => a + r, 0) / n;
  const sigma = Math.sqrt(dailyReturns.reduce((a, r) => a + (r - mean) ** 2, 0) / n);
  return Math.floor(FACTOR_MAX * Math.max(0, 1 - sigma / 0.04));
}

/** F4: share of executed decisions whose reason passes `reasonPasses`. */
export function fExplains(valid: number, executed: number): number {
  return Math.floor((FACTOR_MAX * Math.min(valid, executed)) / Math.max(1, executed));
}

/** What the reason has to name for each asset: its symbol or its common name, as a whole word, any case. */
const ASSET_NAMES: Record<AssetId, readonly string[]> = {
  BTC: ["btc", "bitcoin"],
  ETH: ["eth", "ether", "ethereum"],
  SOL: ["sol", "solana"],
  XRP: ["xrp"],
  GOLD: ["gold"],
};

export function namesAsset(reason: string, asset: AssetId): boolean {
  const words = reason.toLowerCase().split(/[^a-z0-9]+/);
  return ASSET_NAMES[asset].some((name) => words.includes(name));
}

export interface ExecutedDecision {
  reason: string | null;
  reasonTag: string | null;
  /** The decision's trades that reached the chain. */
  trades: readonly { asset: AssetId; side: "BUY" | "SELL" }[];
  /** 24 h change in % per asset, from the decision's logged input. */
  chg24hPct: Partial<Record<AssetId, number | null>>;
}

/**
 * The deterministic F4 check: 10–140 characters, names at least one traded asset, a known `reason_tag`, and a tag
 * that fits the trades. Fitting means the rules the prompt gives the model: `take_profit` and `cut_loss` need a SELL,
 * `buy_dip` needs a BUY of an asset whose 24 h change was negative, `stay_cash` allows no BUY. Other tags fit any trade.
 */
export function reasonPasses(d: ExecutedDecision): boolean {
  const { reason, reasonTag: tag, trades } = d;
  if (reason === null || tag === null) return false;
  const length = Array.from(reason).length;
  if (length < 10 || length > 140) return false;
  if (!trades.some((t) => namesAsset(reason, t.asset))) return false;
  if (!(REASON_TAGS as readonly string[]).includes(tag)) return false;

  const sells = trades.some((t) => t.side === "SELL");
  const buys = trades.filter((t) => t.side === "BUY");
  switch (tag) {
    case "take_profit":
    case "cut_loss":
      return sells;
    case "buy_dip":
      return buys.some((t) => (d.chg24hPct[t.asset] ?? 0) < 0);
    case "stay_cash":
      return buys.length === 0;
    default:
      return true;
  }
}

export interface TrustFactors {
  fRules: number;
  fDrawdown: number;
  fConsistency: number;
  fExplains: number;
  total: number;
}

export function withTotal(f: Omit<TrustFactors, "total">): TrustFactors {
  return { ...f, total: f.fRules + f.fDrawdown + f.fConsistency + f.fExplains };
}
