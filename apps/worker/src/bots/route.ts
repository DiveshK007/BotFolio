import type { IncomingMessage } from "node:http";
import { corsRoute } from "../auth/cors";
import { Throttle } from "../auth/throttle";
import type { Queryable } from "../scheduler/db";
import { sendJson, type Routes } from "../server";

export const BOTS_PATH = "/bots";
export const BOTS_PER_IP_PER_MINUTE = 60;
export const BOTS_CACHE_MS = 60_000;
/** The Dex shows at most this many; newest first. */
export const BOTS_LIMIT = 500;

/** One public Dex entry. Names and emoji are LLM output from user text (#159): clients render them as text only. */
export interface PublicBot {
  botId: string;
  name: string;
  emoji: string;
  isHouse: boolean;
  /** Highest committed version (on-chain VersionCommitted), 1 if none indexed yet. */
  version: number;
  createdAt: string;
}

/** Indexed (created_tx set), not banned. Paused bots still show: their record is public either way. */
export async function listBots(db: Queryable, limit = BOTS_LIMIT): Promise<PublicBot[]> {
  const { rows } = await db.query<{ id: string; name: string; emoji: string; is_house: boolean; version: number | null; created_at: Date }>(
    `select b.id::text as id, b.name, b.emoji, b.is_house, b.created_at,
            (select max(v.version) from bot_versions v where v.bot_id = b.id and v.committed_tx is not null) as version
       from bots b
      where b.created_tx is not null and b.status <> 'banned'
      order by b.created_at desc, b.id desc
      limit $1::int`,
    [limit],
  );
  return rows.map((r) => ({ botId: r.id, name: r.name, emoji: r.emoji, isHouse: r.is_house, version: r.version ?? 1, createdAt: new Date(r.created_at).toISOString() }));
}

export interface BotsRouteOptions {
  /** null = no DATABASE_URL: every call gets 503. */
  db: Queryable | null;
  origins: ReadonlySet<string>;
  clientIp: (req: IncomingMessage) => string;
  now?: () => number;
}

/** GET /bots → every public bot, for the website's Bot Dex (HANDOFF follow-up #6). Public, no sign-in. */
export function botsRoutes({ db, origins, clientIp, now = Date.now }: BotsRouteOptions): Routes {
  const perIp = new Throttle(BOTS_PER_IP_PER_MINUTE, 60_000, 50_000, now);
  let cached: { at: number; bots: Promise<PublicBot[]> } | null = null;

  return corsRoute("GET", BOTS_PATH, origins, async (req, res) => {
    if (!db) return sendJson(res, 503, { ok: false, error: { code: "BOTS_DISABLED", message: "The bot list isn't switched on yet." } });
    const wait = perIp.take(clientIp(req));
    if (wait !== null) {
      res.setHeader("retry-after", String(wait));
      return sendJson(res, 429, { ok: false, error: { code: "RATE_LIMITED_IP", message: "Too many requests. Wait a minute.", retryAfterSeconds: wait } });
    }
    if (!cached || now() - cached.at >= BOTS_CACHE_MS) {
      const mine = { at: now(), bots: listBots(db) };
      mine.bots.catch(() => {
        if (cached === mine) cached = null;
      });
      cached = mine;
    }
    try {
      return sendJson(res, 200, { ok: true, bots: await cached.bots });
    } catch {
      return sendJson(res, 500, { ok: false, error: { code: "INTERNAL", message: "Couldn't read the bot list." } });
    }
  });
}
