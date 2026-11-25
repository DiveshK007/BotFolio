/**
 * /stats (SPEC §11, §12.4): reads the worker's public `GET /stats` (apps/worker/src/stats, #107).
 * The shape mirrors apps/worker/src/stats/stats.ts; packages/shared is frozen, so it's copied, not shared.
 */
import { workerBase } from "./config";

export const STATS_PATH = "/stats";
export const REVALIDATE_S = 60;
const TIMEOUT_MS = 10_000;

export const USER_ACTIONS = [
  { key: "createBot", label: "Bots created", counts: "BotRegistry.BotCreated, not house bots" },
  { key: "correction", label: "Corrections", counts: "SeasonLedger.CallCorrected" },
  { key: "approveV2", label: "Version approvals", counts: "SeasonLedger.VersionCommitted, version 2 and up" },
  { key: "bigMove", label: "Big moves approved", counts: "PaperLedger.ApprovedTrade" },
  { key: "dailyCall", label: "Daily calls", counts: "DailyCall.Called" },
  { key: "challengeCreate", label: "Challenges sent", counts: "Challenges.ChallengeCreated" },
  { key: "challengeAccept", label: "Challenges accepted", counts: "Challenges.ChallengeAccepted" },
] as const;

export const SYSTEM_KINDS = [
  { key: "runnerTrades", label: "Runner trade batches", counts: "PaperLedger.Trade txs that aren't an owner's approved big move" },
  { key: "dailyCallSettles", label: "Daily call settlements", counts: "DailyCall.Settled" },
  { key: "seasonCloses", label: "Season data roots", counts: "SeasonLedger.SeasonClosed" },
  { key: "scoreCommits", label: "Trust score roots", counts: "TrustScoreRegistry.ScoresCommitted, latest per season" },
  { key: "houseBots", label: "House bot setup", counts: "House bots' BotCreated and VersionCommitted (admin key)" },
] as const;

type ActionKey = (typeof USER_ACTIONS)[number]["key"];
type SystemKey = (typeof SYSTEM_KINDS)[number]["key"];

export interface ActivityStats {
  asOf: string;
  userSigned: {
    txs: number;
    signers: number;
    active7d: number;
    active30d: number;
    recurring: number;
    byAction: Record<ActionKey, { txs: number; wallets: number }>;
  };
  system: { txs: number; byKind: Record<SystemKey, number> };
}

export type StatsResult = { kind: "ok"; stats: ActivityStats } | { kind: "not_live" } | { kind: "error" };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

/** Checks the worker's answer before anything renders it. null = off-shape. */
export function parseStats(json: unknown): ActivityStats | null {
  if (!isObj(json) || json.ok !== true || !isObj(json.stats)) return null;
  const { asOf, userSigned: u, system: s } = json.stats;
  if (typeof asOf !== "string" || Number.isNaN(Date.parse(asOf)) || !isObj(u) || !isObj(s)) return null;
  if (![u.txs, u.signers, u.active7d, u.active30d, u.recurring, s.txs].every(isCount)) return null;
  const byAction = u.byAction;
  const byKind = s.byKind;
  if (!isObj(byAction) || !isObj(byKind)) return null;
  for (const { key } of USER_ACTIONS) {
    const a = byAction[key];
    if (!isObj(a) || !isCount(a.txs) || !isCount(a.wallets)) return null;
  }
  if (!SYSTEM_KINDS.every(({ key }) => isCount(byKind[key]))) return null;
  return json.stats as unknown as ActivityStats;
}

/** No worker URL or a 503 → "not live yet"; anything else that fails → error. */
export async function fetchStats(
  base: string | null = workerBase(process.env.NEXT_PUBLIC_RELAY_URL),
  fetchImpl: typeof fetch = fetch,
): Promise<StatsResult> {
  if (!base) return { kind: "not_live" };
  try {
    const res = await fetchImpl(base + STATS_PATH, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: REVALIDATE_S },
    } as RequestInit);
    if (res.status === 503) return { kind: "not_live" };
    if (!res.ok) return { kind: "error" };
    const stats = parseStats(await res.json());
    return stats ? { kind: "ok", stats } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}
