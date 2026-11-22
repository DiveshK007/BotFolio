import type { LlmClient, LlmConfig } from "@botfolio/llm";
import type { IncomingMessage } from "node:http";
import type { Log } from "../auth/log";
import { authedRoute } from "../auth/middleware";
import { Throttle } from "../auth/throttle";
import type { Authenticator } from "../auth/types";
import type { HealthState } from "../health";
import type { Db } from "../relay/db";
import type { Routes } from "../server";
import { savePersonaDraft } from "./drafts";
import { MAX_SENTENCE_CHARS, cleanSentence, createPersona } from "./persona";

/** UNVERIFIED as a product decision (#219): SPEC names no path. It is the one apps/web already calls. */
export const PERSONA_PATH = "/persona";

/*
 * Each call costs LLM money and a SIWE wallet costs nothing to make, so there are three limits. They are ours,
 * not the spec's, and in memory (one instance, reset on restart). The monthly cap is the backstop.
 */
export const PERSONA_PER_WALLET_PER_DAY = 20;
export const PERSONA_PER_IP_PER_MINUTE = 60;
export const PERSONA_PER_HOUR_GLOBAL = 600;

export interface PersonaRouteOptions {
  origins: ReadonlySet<string>;
  auth: Authenticator;
  clientIp: (req: IncomingMessage) => string;
  log: Log;
  /** null = not configured: every call gets 503. */
  service: {
    db: Db;
    llm: LlmClient;
    config: Pick<LlmConfig, "models" | "temperature" | "timeoutMs">;
    health: HealthState;
  } | null;
  now?: () => Date;
}

const refusal = (status: number, code: string, message: string, retryAfterSeconds?: number) => ({
  status,
  body: { ok: false, error: { code, message, ...(retryAfterSeconds !== undefined && { retryAfterSeconds }) } },
});

/**
 * POST /persona `{ sentence, termsAccepted: true }` → `{ ok: true, persona: <§6.3>, personaHash }`.
 *
 * The wallet comes from the verified token, never the body. A Privy user's embedded wallet is listed first,
 * and it is the one that will sign createBot.
 */
export function personaRoutes(options: PersonaRouteOptions): Routes {
  const { origins, auth, clientIp, log, service, now = () => new Date() } = options;
  const clock = () => now().getTime();
  const perWallet = new Throttle(PERSONA_PER_WALLET_PER_DAY, 86_400_000, 100_000, clock);
  const perIp = new Throttle(PERSONA_PER_IP_PER_MINUTE, 60_000, 50_000, clock);
  const global = new Throttle(PERSONA_PER_HOUR_GLOBAL, 3_600_000, 1, clock);

  return authedRoute({
    path: PERSONA_PATH,
    origins,
    auth,
    log,
    async handle({ identity, body, req }) {
      if (!service) return refusal(503, "PERSONA_DISABLED", "Making bots isn't switched on yet.");
      const wallet = identity.wallets[0];
      if (!wallet) return refusal(403, "NO_WALLET", "Your sign-in has no wallet yet. Sign in again.");

      const { sentence, termsAccepted } = (body ?? {}) as { sentence?: unknown; termsAccepted?: unknown };
      if (termsAccepted !== true) {
        return refusal(400, "TERMS_NOT_ACCEPTED", "Confirm you're 18+ and accept the Terms first.");
      }
      if (typeof sentence !== "string" || sentence.length > MAX_SENTENCE_CHARS || !cleanSentence(sentence)) {
        return refusal(400, "BAD_REQUEST", `Describe your bot in one sentence, up to ${MAX_SENTENCE_CHARS} characters.`);
      }
      if (service.health.budget(now()) === "resting") {
        return refusal(503, "BUDGET_RESTING", "The bot maker is resting. Please try again later.");
      }

      let wait = perIp.take(clientIp(req));
      if (wait !== null) return refusal(429, "RATE_LIMITED_IP", "Too many tries from this connection. Wait a minute.", wait);
      wait = perWallet.take(wallet);
      if (wait !== null) return refusal(429, "RATE_LIMITED_USER", "That's all the new personalities for today.", wait);
      wait = global.take("all");
      if (wait !== null) return refusal(429, "RATE_LIMITED_GLOBAL", "The bot maker is very busy. Try again later.", wait);

      const result = await createPersona({ llm: service.llm, config: service.config, sentence });
      if (result.log.usage) service.health.recordLlmUsage(result.log.model, result.log.usage, now());
      if (result.status !== "ok") {
        // Not result.error: it can quote what the model wrote.
        log("persona.failed", { model: result.log.model, promptVersion: result.log.promptVersion });
        return refusal(502, "PERSONA_FAILED", "The bot maker sent back something broken. Please try again.");
      }

      const { persona, personaHash, limits } = result;
      const owner = {
        wallet,
        privyDid: identity.privyDid ?? null,
        loginMethod: identity.kind === "siwe" ? ("qie_wallet" as const) : ("passkey" as const),
      };
      await service.db.transaction((tx) => savePersonaDraft(tx as Parameters<typeof savePersonaDraft>[0], owner, personaHash, persona, now()));
      log("persona.created", { personaHash, promptVersion: result.log.promptVersion, flags: result.flags.length });

      return {
        status: 200,
        body: {
          ok: true,
          personaHash,
          persona: {
            ...persona,
            max_per_coin_pct: limits.maxPerCoinBps / 100,
            max_trades_per_day: limits.maxTradesPerDay,
          },
        },
      };
    },
  });
}
