/**
 * S6 leaderboards (SPEC §8): reads the worker's public `GET /leaderboards` (apps/worker/src/season/route.ts).
 * The shapes mirror apps/worker/src/season/leaderboards.ts; packages/shared is frozen, so they're copied, not shared.
 */
import { FlowError } from "./errors";

export const LEADERBOARDS_PATH = "/leaderboards";
const TIMEOUT_MS = 15_000;

export interface BoardEntry {
  botId: string;
  name: string;
  emoji: string;
  isHouse: boolean;
  ownerQieName: string | null;
  /** null for house bots: listed with a badge, never ranked. */
  rank: number | null;
}
export interface ReturnEntry extends BoardEntry {
  returnBps: number;
  maxDdBps: number;
}
export interface SortinoEntry extends BoardEntry {
  sortino: number;
  returnBps: number;
}
export interface TrustEntry extends BoardEntry {
  total: number;
}
export interface CallEntry extends BoardEntry {
  calls: number;
  you: number;
  bot: number;
}

export interface Leaderboards {
  season: number;
  /** Until the season closes the boards come from the marks so far: provisional. */
  live: boolean;
  trustSeason: number | null;
  topReturns: ReturnEntry[];
  bestRiskAdjusted: SortinoEntry[];
  mostTrusted: TrustEntry[];
  coachVsBot: CallEntry[];
}

export interface LeaderboardsAnswer {
  currentSeason: number;
  boards: Leaderboards;
}

/** The four SPEC §2.4 S6 tabs, in order, with their exact §8 names. */
export const BOARDS = [
  { key: "topReturns", label: "Top Returns" },
  { key: "bestRiskAdjusted", label: "Best Risk-Adjusted (Sortino)" },
  { key: "mostTrusted", label: "Most Trusted" },
  { key: "coachVsBot", label: "Coach vs Bot" },
] as const;
export type BoardKey = (typeof BOARDS)[number]["key"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isEntry(e: unknown): e is BoardEntry {
  return (
    isObj(e) &&
    typeof e.botId === "string" &&
    /^\d{1,20}$/.test(e.botId) && // goes into a /bot/<id> link
    typeof e.name === "string" &&
    typeof e.emoji === "string" &&
    typeof e.isHouse === "boolean" &&
    (e.ownerQieName === null || typeof e.ownerQieName === "string") &&
    (e.rank === null || isInt(e.rank))
  );
}

const list = <T>(v: unknown, extra: (e: Record<string, unknown>) => boolean): T[] | null =>
  Array.isArray(v) && v.every((e) => isEntry(e) && extra(e as unknown as Record<string, unknown>)) ? (v as T[]) : null;

/** Checks the worker's answer before anything renders it. null = off-shape. */
export function parseLeaderboards(json: unknown): LeaderboardsAnswer | null {
  if (!isObj(json) || json.ok !== true || !isInt(json.currentSeason) || !isObj(json.leaderboards)) return null;
  const b = json.leaderboards;
  if (!isInt(b.season) || typeof b.live !== "boolean" || !(b.trustSeason === null || isInt(b.trustSeason))) return null;
  const topReturns = list<ReturnEntry>(b.topReturns, (e) => isInt(e.returnBps) && isInt(e.maxDdBps));
  const bestRiskAdjusted = list<SortinoEntry>(b.bestRiskAdjusted, (e) => isNum(e.sortino) && isInt(e.returnBps));
  const mostTrusted = list<TrustEntry>(b.mostTrusted, (e) => isInt(e.total));
  const coachVsBot = list<CallEntry>(b.coachVsBot, (e) => isInt(e.calls) && e.calls > 0 && isInt(e.you) && isInt(e.bot));
  if (!topReturns || !bestRiskAdjusted || !mostTrusted || !coachVsBot) return null;
  return {
    currentSeason: json.currentSeason,
    boards: { season: b.season, live: b.live, trustSeason: b.trustSeason as number | null, topReturns, bestRiskAdjusted, mostTrusted, coachVsBot },
  };
}

/** GET /leaderboards[?season=n]. No season = the current one. Failures come back as a FlowError with plain words. */
export async function fetchLeaderboards(workerUrl: string, season: number | null, signal?: AbortSignal): Promise<LeaderboardsAnswer> {
  const noAnswer = "The leaderboards aren't answering. Please try again.";
  const url = workerUrl + LEADERBOARDS_PATH + (season === null ? "" : `?season=${season}`);
  // AbortSignal.any needs iOS 17.4, so join the caller's signal and the timeout by hand.
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, TIMEOUT_MS);
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort);
  try {
    const res = await fetch(url, { credentials: "omit", signal: controller.signal });
    const json: unknown = await res.json().catch(() => null);
    if (res.ok) {
      const answer = parseLeaderboards(json);
      if (answer) return answer;
      throw new FlowError("BAD_RESPONSE", noAnswer);
    }
    const error = isObj(json) && isObj(json.error) ? json.error : null;
    if (error && typeof error.code === "string" && typeof error.message === "string") {
      throw new FlowError(error.code, error.message.slice(0, 200));
    }
    throw new FlowError("BAD_RESPONSE", noAnswer);
  } catch (e) {
    if (e instanceof FlowError) throw e;
    throw new FlowError("NO_ANSWER", noAnswer);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** Basis points → percent with two decimals: 1234 → "+12.34%", −50 → "−0.50%". */
export function formatBps(bps: number, signed = true): string {
  const abs = (Math.abs(bps) / 100).toFixed(2) + "%";
  if (bps < 0) return `−${abs}`;
  return signed && bps > 0 ? `+${abs}` : abs;
}

export const formatSortino = (s: number) => (s < 0 ? `−${Math.abs(s).toFixed(2)}` : s.toFixed(2));

/** Owner's Daily Call win rate, whole percent: 3 of 4 → "75%". */
export const winRate = (e: Pick<CallEntry, "you" | "calls">) => `${Math.round((100 * e.you) / e.calls)}%`;

/** `?season=` from the URL: a plain season number, else null (= current). */
export function parseSeasonParam(raw: string | string[] | undefined): number | null {
  return typeof raw === "string" && /^(0|[1-9]\d{0,8})$/.test(raw) ? Number(raw) : null;
}
