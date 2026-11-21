import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { HealthState } from "./health";

export interface ServerDeps {
  health: HealthState;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

/**
 * Plain node:http server. Routes so far: GET /healthz. /relay, /auth/*, /internal/slot and /mcp
 * plug into the same table in later issues.
 */
export function createWorkerServer(deps: ServerDeps): Server {
  const routes: Record<string, Handler> = {
    // Always 200 while the process is up: Render restarts a service whose health check fails,
    // and a stale gold price is not a reason to restart. Degradation is reported in the body.
    "GET /healthz": (_req, res) => sendJson(res, 200, deps.health.snapshot()),
  };

  return createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const method = req.method === "HEAD" ? "GET" : (req.method ?? "GET");
    const handler = routes[`${method} ${path}`];
    try {
      if (!handler) return sendJson(res, 404, { error: "not found" });
      await handler(req, res);
    } catch (e) {
      console.error(`[server] ${req.method} ${path} failed`, e);
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
    }
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(res.req?.method === "HEAD" ? undefined : text);
}
