import { RELAY_AUTH_KIND_HEADER } from "@botfolio/shared";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Handler, Routes } from "../server";

const ALLOWED_HEADERS = ["authorization", "content-type", RELAY_AUTH_KIND_HEADER];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * The web origins allowed to read our answers: WEB_ORIGINS (comma-separated), else APP_URL.
 * Exact origins only, no wildcard. Plain http is for local dev.
 */
export function loadAllowedOrigins(env: Record<string, string | undefined>): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const raw of (env.WEB_ORIGINS || env.APP_URL || "").split(",")) {
    if (!URL.canParse(raw.trim())) continue;
    const url = new URL(raw.trim());
    if (url.hostname.includes("*")) continue;
    if (url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) origins.add(url.origin);
  }
  return origins;
}

/**
 * One browser-callable endpoint: the handler plus its OPTIONS preflight. Reusable for /relay, /auth/* and /persona.
 * CORS only controls what a browser lets a page read; it is not authentication.
 */
export function corsRoute(method: "GET" | "POST", path: string, origins: ReadonlySet<string>, handler: Handler): Routes {
  const allow = (req: IncomingMessage, res: ServerResponse): boolean => {
    res.setHeader("vary", "origin");
    const origin = req.headers.origin;
    if (!origin || !origins.has(origin)) return false;
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-expose-headers", "retry-after");
    return true;
  };
  return {
    [`${method} ${path}`]: (req, res) => {
      allow(req, res);
      return handler(req, res);
    },
    [`OPTIONS ${path}`]: (req, res) => {
      if (!allow(req, res)) {
        res.writeHead(403).end();
        return;
      }
      res.writeHead(204, {
        "access-control-allow-methods": method,
        "access-control-allow-headers": ALLOWED_HEADERS.join(", "),
        "access-control-max-age": "600",
      });
      res.end();
    },
  };
}
