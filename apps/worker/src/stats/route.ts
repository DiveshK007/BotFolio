import type { IncomingMessage } from "node:http";
import { corsRoute } from "../auth/cors";
import { Throttle } from "../auth/throttle";
import type { Queryable } from "../scheduler/db";
import { sendJson, type Routes } from "../server";
import { activityStats, type ActivityStats } from "./stats";

export const STATS_PATH = "/stats";
export const STATS_PER_IP_PER_MINUTE = 120;
/** Traction numbers move slowly; a minute old keeps the counting queries off every request. */
export const STATS_CACHE_MS = 60_000;

export interface StatsRouteOptions {
  /** null = no DATABASE_URL: every call gets 503. */
  db: Queryable | null;
  origins: ReadonlySet<string>;
  clientIp: (req: IncomingMessage) => string;
  now?: () => number;
}

/** GET /stats → user-signed activity (by _msgSender) and system txs, kept apart (SPEC §11, #107). Public, no sign-in. */
export function statsRoutes({ db, origins, clientIp, now = Date.now }: StatsRouteOptions): Routes {
  const perIp = new Throttle(STATS_PER_IP_PER_MINUTE, 60_000, 50_000, now);
  let cached: { at: number; stats: Promise<ActivityStats> } | null = null;

  return corsRoute("GET", STATS_PATH, origins, async (req, res) => {
    if (!db) return sendJson(res, 503, { ok: false, error: { code: "STATS_DISABLED", message: "Stats aren't switched on yet." } });
    const wait = perIp.take(clientIp(req));
    if (wait !== null) {
      res.setHeader("retry-after", String(wait));
      return sendJson(res, 429, { ok: false, error: { code: "RATE_LIMITED_IP", message: "Too many requests. Wait a minute.", retryAfterSeconds: wait } });
    }
    if (!cached || now() - cached.at >= STATS_CACHE_MS) {
      // Concurrent requests share one computation; a failed one isn't kept.
      const mine = { at: now(), stats: activityStats(db, new Date(now())) };
      mine.stats.catch(() => {
        if (cached === mine) cached = null;
      });
      cached = mine;
    }
    return sendJson(res, 200, { ok: true, stats: await cached.stats });
  });
}
