import type { IncomingMessage } from "node:http";
import { corsRoute } from "../auth/cors";
import { Throttle } from "../auth/throttle";
import type { Queryable } from "../scheduler/db";
import { sendJson, type Routes } from "../server";

export const CHALLENGE_PATH = "/challenge";
export const CHALLENGE_PER_IP_PER_MINUTE = 120;

export interface ChallengeRouteOptions {
  /** null = no DATABASE_URL: every call gets 503. */
  db: Queryable | null;
  origins: ReadonlySet<string>;
  clientIp: (req: IncomingMessage) => string;
  now?: () => number;
}

interface Side {
  botId: string;
  name: string;
  emoji: string;
  ownerWallet: string;
}

export interface PublicChallenge {
  /** Full bytes32 code: what `Challenges.accept` needs. */
  code: string;
  season: number;
  status: string;
  challenger: Side;
  opponent: Side | null;
  createTx: string | null;
  acceptTx: string | null;
  winnerBotId: string | null;
}

/** Share links carry the first 8 bytes of the code (SPEC §2.5), as 16 hex chars. */
const SHORT = /^[0-9a-f]{16}$/;

/**
 * GET /challenge?code=<16 hex> → `{ ok, challenge: PublicChallenge }` (S10, #85). Public, no sign-in: the same
 * data as `site_challenge_by_short_code` and `site_bots`. Resolves a share link's short code to the full code.
 */
export function challengeRoutes({ db, origins, clientIp, now = Date.now }: ChallengeRouteOptions): Routes {
  const perIp = new Throttle(CHALLENGE_PER_IP_PER_MINUTE, 60_000, 50_000, now);

  return corsRoute("GET", CHALLENGE_PATH, origins, async (req, res) => {
    if (!db) return sendJson(res, 503, { ok: false, error: { code: "CHALLENGES_DISABLED", message: "Challenges aren't switched on yet." } });
    const wait = perIp.take(clientIp(req));
    if (wait !== null) {
      res.setHeader("retry-after", String(wait));
      return sendJson(res, 429, { ok: false, error: { code: "RATE_LIMITED_IP", message: "Too many requests. Wait a minute.", retryAfterSeconds: wait } });
    }
    const code = (new URL(req.url ?? "/", "http://worker").searchParams.get("code") ?? "").toLowerCase().replace(/^0x/, "");
    if (!SHORT.test(code)) return sendJson(res, 400, { ok: false, error: { code: "BAD_REQUEST", message: "That challenge link looks broken." } });

    const { rows } = await db.query<{
      code: string; season: number; status: string; create_tx: string | null; accept_tx: string | null; winner: string | null;
      c_id: string; c_name: string; c_emoji: string; c_owner: string;
      o_id: string | null; o_name: string | null; o_emoji: string | null; o_owner: string | null;
    }>(
      `select c.code, c.season_id as season, c.status::text as status, c.create_tx, c.accept_tx, c.winner_bot::text as winner,
              cb.id::text as c_id, cb.name as c_name, cb.emoji as c_emoji, cb.owner_wallet as c_owner,
              ob.id::text as o_id, ob.name as o_name, ob.emoji as o_emoji, ob.owner_wallet as o_owner
       from challenges c join bots cb on cb.id = c.challenger_bot left join bots ob on ob.id = c.opponent_bot
       where substring(c.code from 3 for 16) = $1::text
       order by c.code limit 2`,
      [code],
    );
    // Two codes sharing 8 bytes is ~2^-64 a pair; refuse rather than pick one.
    if (rows.length !== 1) return sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "We couldn't find that challenge." } });
    const r = rows[0]!;
    const challenge: PublicChallenge = {
      code: r.code,
      season: r.season,
      status: r.status,
      challenger: { botId: r.c_id, name: r.c_name, emoji: r.c_emoji, ownerWallet: r.c_owner },
      opponent: r.o_id ? { botId: r.o_id, name: r.o_name!, emoji: r.o_emoji!, ownerWallet: r.o_owner! } : null,
      createTx: r.create_tx,
      acceptTx: r.accept_tx,
      winnerBotId: r.winner,
    };
    return sendJson(res, 200, { ok: true, challenge });
  });
}
