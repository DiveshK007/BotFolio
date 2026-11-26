import type { LlmClient, LlmConfig, LlmUsage } from "@botfolio/llm";
import type { IncomingMessage } from "node:http";
import type { Log } from "../auth/log";
import { ASSUMED_OUTPUT_TOKENS, SYSTEM_PROMPT_TOKENS } from "../budget/spend";
import { authedRoute } from "../auth/middleware";
import { Throttle } from "../auth/throttle";
import type { Authenticator } from "../auth/types";
import type { HealthState } from "../health";
import type { Db } from "../relay/db";
import type { Routes } from "../server";
import { DNA_SEED_PATTERN, savePersonaDraft } from "./drafts";
import { MAX_SENTENCE_CHARS, cleanSentence, createPersona } from "./persona";

/** UNVERIFIED as a product decision (#219): SPEC names no path. It is the one apps/web already calls. */
export const PERSONA_PATH = "/persona";

/*
 * Each call costs LLM money and a SIWE wallet costs nothing to make, so the per-wallet limit only slows honest
 * users. The per-IP hour limit is what stops one connection holding the global quota with throwaway wallets.
 * They are ours, not the spec's, and in memory (one instance, reset on restart). The monthly cap is the backstop:
 * every call, failed or not, is counted against it (HealthState.recordUnloggedLlmUsage).
 */
export const PERSONA_PER_WALLET_PER_DAY = 20;
export const PERSONA_PER_IP_PER_MINUTE = 60;
/** Per IPv4 address or IPv6 /64 (auth/client-ip.ts). A shared NAT (a venue's wifi) shares it too. */
export const PERSONA_PER_IP_PER_HOUR = 30;
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
 * POST /persona `{ sentence, termsAccepted: true, dnaSeed? }` → `{ ok: true, persona: <§6.3>, personaHash, dnaSeed }`.
 *
 * The wallet comes from the verified token, never the body. A Privy user's embedded wallet is listed first,
 * and it is the one that will sign createBot.
 */
export function personaRoutes(options: PersonaRouteOptions): Routes {
  const { origins, auth, clientIp, log, service, now = () => new Date() } = options;
  const clock = () => now().getTime();
  const perWallet = new Throttle(PERSONA_PER_WALLET_PER_DAY, 86_400_000, 100_000, clock);
  const perIp = new Throttle(PERSONA_PER_IP_PER_MINUTE, 60_000, 50_000, clock);
  const perIpHour = new Throttle(PERSONA_PER_IP_PER_HOUR, 3_600_000, 50_000, clock);
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

      const { sentence, termsAccepted, dnaSeed } = (body ?? {}) as { sentence?: unknown; termsAccepted?: unknown; dnaSeed?: unknown };
      if (termsAccepted !== true) {
        return refusal(400, "TERMS_NOT_ACCEPTED", "Confirm you're 18+ and accept the Terms first.");
      }
      if (typeof sentence !== "string" || sentence.length > MAX_SENTENCE_CHARS || !cleanSentence(sentence)) {
        return refusal(400, "BAD_REQUEST", `Describe your bot in one sentence, up to ${MAX_SENTENCE_CHARS} characters.`);
      }
      if (dnaSeed !== undefined && dnaSeed !== null && (typeof dnaSeed !== "string" || !DNA_SEED_PATTERN.test(dnaSeed))) {
        return refusal(400, "BAD_REQUEST", "Invalid dnaSeed.");
      }
      const cleanSeed = typeof dnaSeed === "string" ? dnaSeed : null;
      if (service.health.budget(now()) === "resting") {
        return refusal(503, "BUDGET_RESTING", "The bot maker is resting. Please try again later.");
      }

      const ip = clientIp(req);
      let wait = perIp.take(ip);
      if (wait !== null) return refusal(429, "RATE_LIMITED_IP", "Too many tries from this connection. Wait a minute.", wait);
      wait = perIpHour.take(ip);
      if (wait !== null) return refusal(429, "RATE_LIMITED_IP", "Too many tries from this connection. Try again later.", wait);
      wait = perWallet.take(wallet);
      if (wait !== null) return refusal(429, "RATE_LIMITED_USER", "That's all the new personalities for today.", wait);
      wait = global.take("all");
      if (wait !== null) return refusal(429, "RATE_LIMITED_GLOBAL", "The bot maker is very busy. Try again later.", wait);

      const result = await createPersona({ llm: service.llm, config: service.config, sentence });
      service.health.recordUnloggedLlmUsage(result.log.model, callUsage(result.log, sentence), now());
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
      await service.db.transaction((tx) => savePersonaDraft(tx as Parameters<typeof savePersonaDraft>[0], owner, personaHash, persona, now(), cleanSeed));
      log("persona.created", { personaHash, promptVersion: result.log.promptVersion, flags: result.flags.length });

      return {
        status: 200,
        body: {
          ok: true,
          personaHash,
          dnaSeed: cleanSeed,
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

/** Every try counts, as in budget/spend.ts. A failure has no count, so assume both tries ran and erred high. */
export function callUsage(log: { usage: LlmUsage | null; attempts: number | null }, sentence: string): LlmUsage {
  if (log.usage) {
    const tries = log.attempts ?? 1;
    return { inTok: log.usage.inTok * tries, outTok: log.usage.outTok * tries };
  }
  return { inTok: 2 * (SYSTEM_PROMPT_TOKENS + Math.ceil(sentence.length / 3)), outTok: 2 * ASSUMED_OUTPUT_TOKENS };
}
