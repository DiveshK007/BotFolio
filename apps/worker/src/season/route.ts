import type { IncomingMessage } from "node:http";
import { corsRoute } from "../auth/cors";
import { Throttle } from "../auth/throttle";
import type { Queryable } from "../scheduler/db";
import { sendJson, type Routes } from "../server";
import { currentSeason, leaderboards, type Leaderboards } from "./leaderboards";

export const LEADERBOARDS_PATH = "/leaderboards";
export const LEADERBOARDS_PER_IP_PER_MINUTE = 120;
/** A live board changes once a slot; a minute old is fresh enough and keeps the marks query off every request. */
export const LEADERBOARDS_CACHE_MS = 60_000;

export interface LeaderboardRouteOptions {
  /** null = no DATABASE_URL or PAPER_LEDGER_ADDRESS: every call gets 503. */
  source: { db: Queryable; startCashE8: () => Promise<bigint> } | null;
  origins: ReadonlySet<string>;
  clientIp: (req: IncomingMessage) => string;
  now?: () => number;
}

const SEASON = /^(0|[1-9]\d{0,8})$/;

/**
 * GET /leaderboards?season=<n> → the four SPEC §8 boards for that season, ranked (#60). Public, no sign-in.
 * Without `season`, the current one (#84). Every answer also gives `currentSeason`, so the page knows how far "next" goes.
 */
export function leaderboardRoutes({ source, origins, clientIp, now = Date.now }: LeaderboardRouteOptions): Routes {
  const perIp = new Throttle(LEADERBOARDS_PER_IP_PER_MINUTE, 60_000, 50_000, now);
  const cache = new Map<number, { at: number; boards: Promise<Leaderboards | null> }>();
  let current: { at: number; season: Promise<number | null> } | null = null;

  return corsRoute("GET", LEADERBOARDS_PATH, origins, async (req, res) => {
    if (!source) return sendJson(res, 503, { ok: false, error: { code: "LEADERBOARDS_DISABLED", message: "Leaderboards aren't switched on yet." } });
    const wait = perIp.take(clientIp(req));
    if (wait !== null) {
      res.setHeader("retry-after", String(wait));
      return sendJson(res, 429, { ok: false, error: { code: "RATE_LIMITED_IP", message: "Too many requests. Wait a minute.", retryAfterSeconds: wait } });
    }
    const raw = new URL(req.url ?? "/", "http://worker").searchParams.get("season");
    if (raw !== null && !SEASON.test(raw)) return sendJson(res, 400, { ok: false, error: { code: "BAD_REQUEST", message: "Give a season number." } });

    // The current season changes at most twice a day; same cache rule as the boards.
    if (!current || now() - current.at >= LEADERBOARDS_CACHE_MS) {
      const mine = { at: now(), season: currentSeason(source.db, new Date(now())) };
      mine.season.catch(() => {
        if (current === mine) current = null;
      });
      current = mine;
    }
    const latest = await current.season;
    const season = raw === null ? latest : Number(raw);
    if (season === null) return sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "No season has started yet." } });
    // S0 is the hidden test season (#219).
    if (season === 0) return sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "No such season." } });

    let hit = cache.get(season);
    if (!hit || now() - hit.at >= LEADERBOARDS_CACHE_MS) {
      hit = { at: now(), boards: leaderboards(source.db, season, source.startCashE8) };
      // Concurrent requests share one computation; a failed one isn't kept.
      const mine = hit;
      hit.boards.catch(() => {
        if (cache.get(season) === mine) cache.delete(season);
      });
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(season, hit);
    }
    const boards = await hit.boards;
    if (!boards) return sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "No such season." } });
    return sendJson(res, 200, { ok: true, currentSeason: latest, leaderboards: boards });
  });
}
