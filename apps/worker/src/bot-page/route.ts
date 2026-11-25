import type { IncomingMessage } from "node:http";
import { corsRoute } from "../auth/cors";
import { Throttle } from "../auth/throttle";
import type { Queryable } from "../scheduler/db";
import { sendJson, type Routes } from "../server";
import { botPage } from "./page";

export const BOT_PAGE_PATH = "/bot-page";
export const BOT_PAGE_PER_IP_PER_MINUTE = 120;

export interface BotPageRouteOptions {
  /** null = no DATABASE_URL or PAPER_LEDGER_ADDRESS: every call gets 503. */
  source: { db: Queryable; startCashE8: () => Promise<bigint> } | null;
  origins: ReadonlySet<string>;
  clientIp: (req: IncomingMessage) => string;
  now?: () => number;
}

const BOT_ID = /^[1-9]\d{0,19}$/;

/** GET /bot-page?bot=<botId> → everything the public bot page (S4, #78) shows. Public, no sign-in. */
export function botPageRoutes({ source, origins, clientIp, now = Date.now }: BotPageRouteOptions): Routes {
  const perIp = new Throttle(BOT_PAGE_PER_IP_PER_MINUTE, 60_000, 50_000, now);

  return corsRoute("GET", BOT_PAGE_PATH, origins, async (req, res) => {
    if (!source) return sendJson(res, 503, { ok: false, error: { code: "BOT_PAGE_DISABLED", message: "Bot pages aren't switched on yet." } });
    const wait = perIp.take(clientIp(req));
    if (wait !== null) {
      res.setHeader("retry-after", String(wait));
      return sendJson(res, 429, { ok: false, error: { code: "RATE_LIMITED_IP", message: "Too many requests. Wait a minute.", retryAfterSeconds: wait } });
    }
    const bot = new URL(req.url ?? "/", "http://worker").searchParams.get("bot") ?? "";
    if (!BOT_ID.test(bot)) return sendJson(res, 400, { ok: false, error: { code: "BAD_REQUEST", message: "Give a bot id." } });

    const page = await botPage(source.db, BigInt(bot), source.startCashE8);
    if (!page) return sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "No such bot." } });
    return sendJson(res, 200, { ok: true, page });
  });
}
