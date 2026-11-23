import type { IncomingMessage } from "node:http";
import { Throttle } from "../auth/throttle";
import { corsRoute } from "../auth/cors";
import type { Queryable } from "../scheduler/db";
import { sendJson, type Routes } from "../server";
import { scoreProof } from "./scores";

export const TRUST_PROOF_PATH = "/trust/proof";
export const TRUST_PROOF_PER_IP_PER_MINUTE = 120;

export interface TrustRouteOptions {
  /** null = no DATABASE_URL: every call gets 503. */
  db: Queryable | null;
  origins: ReadonlySet<string>;
  clientIp: (req: IncomingMessage) => string;
  now?: () => number;
}

const SEASON = /^(0|[1-9]\d{0,8})$/;
const BOT_ID = /^[1-9]\d{0,19}$/;

/**
 * GET /trust/proof?season=<n>&bot=<botId> → a bot's trust score for that season and the Merkle proof for
 * `TrustScoreRegistry.verifyScore(season, botId, fRules, fDrawdown, fConsistency, fExplains, total, proof)` (#59).
 *
 * Public data, no sign-in: the same scores are in `site_trust_scores` and the uploaded scores file. `committedRoot`
 * stays null until the indexer has seen `ScoresCommitted`; until then the proof is for a root not yet on-chain.
 */
export function trustRoutes({ db, origins, clientIp, now = Date.now }: TrustRouteOptions): Routes {
  const perIp = new Throttle(TRUST_PROOF_PER_IP_PER_MINUTE, 60_000, 50_000, now);

  return corsRoute("GET", TRUST_PROOF_PATH, origins, async (req, res) => {
    if (!db) return sendJson(res, 503, { ok: false, error: { code: "TRUST_DISABLED", message: "Trust scores aren't switched on yet." } });
    const wait = perIp.take(clientIp(req));
    if (wait !== null) {
      res.setHeader("retry-after", String(wait));
      return sendJson(res, 429, { ok: false, error: { code: "RATE_LIMITED_IP", message: "Too many requests. Wait a minute.", retryAfterSeconds: wait } });
    }

    const query = new URL(req.url ?? "/", "http://worker").searchParams;
    const season = query.get("season") ?? "";
    const bot = query.get("bot") ?? "";
    if (!SEASON.test(season) || !BOT_ID.test(bot)) {
      return sendJson(res, 400, { ok: false, error: { code: "BAD_REQUEST", message: "Give a season number and a bot id." } });
    }

    const found = await scoreProof(db, Number(season), BigInt(bot));
    if (!found) return sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "No trust score for that bot and season." } });
    return sendJson(res, 200, { ok: true, score: found });
  });
}
