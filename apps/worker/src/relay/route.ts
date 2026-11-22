import type { IncomingMessage } from "node:http";
import { RELAY_PATH } from "@botfolio/shared";
import { corsRoute } from "../auth/cors";
import { readJson } from "../auth/http";
import { sendJson, type Routes } from "../server";
import { RelayRefusal } from "./errors";
import type { Relay } from "./pipeline";

export interface RelayRouteOptions {
  /** null = switched off or not fully configured: every request gets RELAY_DISABLED. */
  relay: Relay | null;
  origins: ReadonlySet<string>;
  clientIp?: (req: IncomingMessage) => string;
}

export function relayRoutes({ relay, origins, clientIp = socketIp }: RelayRouteOptions): Routes {
  return corsRoute("POST", RELAY_PATH, origins, async (req, res) => {
    const refuseUnread = (refusal: RelayRefusal) => {
      res.setHeader("connection", "close");
      sendJson(res, refusal.httpStatus, refusal.toBody());
    };
    if (!relay) return refuseUnread(new RelayRefusal("RELAY_DISABLED"));

    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return refuseUnread(new RelayRefusal("BAD_REQUEST"));
    }

    const result = await relay({ body, headers: req.headers, ip: clientIp(req) });
    if (!result.body.ok && result.body.error.retryAfterSeconds !== undefined) {
      res.setHeader("retry-after", String(result.body.error.retryAfterSeconds));
    }
    sendJson(res, result.status, result.body);
  });
}

const socketIp = (req: IncomingMessage): string => req.socket.remoteAddress ?? "unknown";
