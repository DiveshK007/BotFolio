import type { IncomingMessage } from "node:http";
import type { AssetId } from "@botfolio/shared";
import { Throttle } from "../auth/throttle";
import { corsRoute } from "../auth/cors";
import type { HealthState } from "../health";
import { sendJson, type Routes } from "../server";

export const STATUS_PATH = "/status";
export const STATUS_PER_IP_PER_MINUTE = 60;
const MAX_AGE_SECONDS = 30;

/** What the site banner (#171) may know. Nothing else from /healthz: no job names, spend or env problems. */
export interface PublicStatus {
  ok: true;
  /** Feeds bots are holding on: too old or unreadable (SPEC §5). Empty before the first oracle check. */
  staleFeeds: AssetId[];
  /** LLM budget used up, so bots hold instead of calling the model (SPEC §6.6). */
  resting: boolean;
}

export function publicStatus(health: HealthState, now: Date = new Date()): PublicStatus {
  const { oracle, llm } = health.snapshot(now);
  return {
    ok: true,
    staleFeeds: oracle.feeds.filter((f) => f.error || !f.fresh).map((f) => f.asset),
    resting: llm.budget === "resting",
  };
}

export interface StatusRouteOptions {
  health: HealthState;
  origins: ReadonlySet<string>;
  clientIp: (req: IncomingMessage) => string;
  now?: () => number;
}

/** GET /status → PublicStatus. Public, no sign-in, cached 30 s by the browser. */
export function statusRoutes({ health, origins, clientIp, now = Date.now }: StatusRouteOptions): Routes {
  const perIp = new Throttle(STATUS_PER_IP_PER_MINUTE, 60_000, 50_000, now);

  return corsRoute("GET", STATUS_PATH, origins, (req, res) => {
    const wait = perIp.take(clientIp(req));
    if (wait !== null) {
      res.setHeader("retry-after", String(wait));
      return sendJson(res, 429, { ok: false, error: { code: "RATE_LIMITED_IP", message: "Too many requests. Wait a minute.", retryAfterSeconds: wait } });
    }
    // Not sendJson: that always says no-store.
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${MAX_AGE_SECONDS}` });
    res.end(req.method === "HEAD" ? undefined : JSON.stringify(publicStatus(health, new Date(now()))));
  });
}
