import type { IncomingMessage } from "node:http";
import { sendJson, type Routes } from "../server";
import { corsRoute } from "./cors";
import { readJson } from "./http";
import { errorLabel, type Log } from "./log";
import type { Authenticator, Identity } from "./types";

export interface AuthedRouteOptions {
  path: string;
  origins: ReadonlySet<string>;
  auth: Authenticator;
  log: Log;
  /** Runs only for a signed-in caller. Use `identity`, not wallet fields in `body`. */
  handle(call: { identity: Identity; body: unknown; req: IncomingMessage }): Promise<{ status: number; body: unknown }>;
}

/**
 * Auth + CORS + body cap for a POST JSON route, e.g. /persona:
 *
 *   ...authedRoute({ path: "/persona", origins, auth, log, handle: async ({ identity, body }) => … })
 *
 * /relay doesn't use it, because the frozen order there parses the body before it checks auth.
 */
export function authedRoute({ path, origins, auth, log, handle }: AuthedRouteOptions): Routes {
  return corsRoute("POST", path, origins, async (req, res) => {
    const refuse = (status: number, code: string, message: string) => {
      res.setHeader("connection", "close");
      sendJson(res, status, { ok: false, error: { code, message } });
    };

    let identity: Identity | null;
    try {
      identity = await auth.authenticate(req.headers);
    } catch (error) {
      log("auth.unavailable", { path, cause: errorLabel(error) });
      return refuse(500, "INTERNAL", "We couldn't check your sign-in. Please try again.");
    }
    if (!identity) return refuse(401, "UNAUTHORIZED", "Your sign-in is missing or expired. Please sign in again.");

    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return refuse(400, "BAD_REQUEST", "That request didn't look right.");
    }

    try {
      const result = await handle({ identity, body, req });
      sendJson(res, result.status, result.body);
    } catch (error) {
      log("route.failed", { path, cause: errorLabel(error) });
      refuse(500, "INTERNAL", "Something went wrong on our side. Please try again.");
    }
  });
}
