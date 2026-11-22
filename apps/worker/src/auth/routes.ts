import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AUTH_NONCE_PATH,
  AUTH_VERIFY_PATH,
  type AuthErrorCode,
  type AuthVerifyError,
  type AuthVerifySuccess,
} from "@botfolio/shared";
import { getAddress } from "viem";
import { sendJson, type Routes } from "../server";
import { corsRoute } from "./cors";
import { readJson } from "./http";
import type { RelayJwt } from "./jwt";
import { errorLabel, type Log } from "./log";
import type { NonceService } from "./nonce";
import { AuthRefusal, verifySiwe } from "./siwe";
import { Throttle } from "./throttle";

const MESSAGES: Record<AuthErrorCode, string> = {
  BAD_REQUEST: "That sign-in message didn't look right. Please try again.",
  DOMAIN_MISMATCH: "That sign-in was made for a different site.",
  CHAIN_MISMATCH: "Switch your wallet to QIE mainnet (1990) and sign in again.",
  INVALID_NONCE: "That sign-in was already used or isn't from BotFolio. Please try again.",
  NONCE_EXPIRED: "That sign-in expired. Please try again.",
  INVALID_SIGNATURE: "That signature doesn't match the wallet.",
  INTERNAL: "Sign-in isn't working right now. Please try again.",
};

/** Signature recovery costs CPU, and each new login is a new identity. */
const VERIFIES_PER_IP_PER_MINUTE = 30;

export interface AuthRouteOptions {
  origins: ReadonlySet<string>;
  clientIp: (req: IncomingMessage) => string;
  log: Log;
  /** null = not configured: both routes answer 503. */
  siwe: { domain: string; jwt: RelayJwt; nonces: NonceService } | null;
  throttle?: Throttle;
  now?: () => number;
}

export function authRoutes({ origins, clientIp, log, siwe, throttle, now = Date.now }: AuthRouteOptions): Routes {
  const perIp = throttle ?? new Throttle(VERIFIES_PER_IP_PER_MINUTE, 60_000);
  const refuse = (res: ServerResponse, status: number, code: AuthErrorCode, message = MESSAGES[code]) => {
    res.setHeader("connection", "close");
    sendJson(res, status, { ok: false, error: { code, message } } satisfies AuthVerifyError);
  };

  return {
    ...corsRoute("GET", AUTH_NONCE_PATH, origins, (_req, res) => {
      if (!siwe) return refuse(res, 503, "INTERNAL");
      sendJson(res, 200, siwe.nonces.issue());
    }),

    ...corsRoute("POST", AUTH_VERIFY_PATH, origins, async (req, res) => {
      if (!siwe) return refuse(res, 503, "INTERNAL");
      const wait = perIp.take(clientIp(req));
      if (wait !== null) {
        res.setHeader("retry-after", String(wait));
        // AUTH_ERROR_CODES has no rate-limit code, so the 429 carries it.
        return refuse(res, 429, "INTERNAL", "Too many sign-in tries. Wait a minute and try again.");
      }

      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        return refuse(res, 400, "BAD_REQUEST");
      }
      try {
        const wallet = await verifySiwe(body, { domain: siwe.domain, nonces: siwe.nonces, now });
        const { token, expiresAt } = await siwe.jwt.sign(wallet);
        sendJson(res, 200, { ok: true, token, address: getAddress(wallet), expiresAt } satisfies AuthVerifySuccess);
      } catch (error) {
        if (error instanceof AuthRefusal) {
          log("auth.refused", { code: error.code });
          return refuse(res, error.code === "BAD_REQUEST" ? 400 : 401, error.code);
        }
        log("auth.failed", { cause: errorLabel(error) });
        refuse(res, 500, "INTERNAL");
      }
    }),
  };
}
