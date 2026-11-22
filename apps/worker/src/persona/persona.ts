import { LlmError, type LlmClient, type LlmConfig, type LlmUsage } from "@botfolio/llm";
import type { Hex } from "viem";
import { hashJson } from "../canonical";
import { containsUrl, stripUrls } from "../text/urls";
import { PERSONA_PROMPT_HASH, PERSONA_PROMPT_VERSION, PERSONA_SYSTEM_PROMPT } from "./prompt";
import { LIMITS, PERSONA_SCHEMA, type PersonaOutput } from "./schema";

/** Our cap on the user's sentence (SPEC §11 asks for a length cap but gives no number). */
export const MAX_SENTENCE_CHARS = 200;

export interface Persona {
  name: string;
  emoji: string;
  persona: string;
  rules: string;
}

export interface BotLimits {
  maxPerCoinBps: number;
  maxTradesPerDay: number;
}

export interface PersonaFlag {
  field: keyof Persona;
  rule: "url" | "not_an_emoji" | "empty";
}

export interface PersonaCallLog {
  promptVersion: string;
  promptHash: Hex;
  model: string;
  temperature: number | undefined;
  raw: string | null;
  usage: LlmUsage | null;
  attempts: number | null;
}

export type PersonaResult =
  | { status: "ok"; persona: Persona; personaHash: Hex; limits: BotLimits; flags: PersonaFlag[]; log: PersonaCallLog }
  | { status: "invalid"; error: string; log: PersonaCallLog };

export interface PersonaCallOptions {
  llm: LlmClient;
  config: Pick<LlmConfig, "models" | "temperature" | "timeoutMs">;
  sentence: string;
}

/** One sentence → persona + slider defaults (SPEC §2.1, §6.3). */
export async function createPersona({ llm, config, sentence }: PersonaCallOptions): Promise<PersonaResult> {
  const model = config.models.persona;
  const log: PersonaCallLog = {
    promptVersion: PERSONA_PROMPT_VERSION,
    promptHash: PERSONA_PROMPT_HASH,
    model,
    temperature: config.temperature,
    raw: null,
    usage: null,
    attempts: null,
  };

  const cleaned = cleanSentence(sentence);
  if (!cleaned) return { status: "invalid", error: "empty sentence", log };

  try {
    const res = await llm.complete<PersonaOutput>({
      system: PERSONA_SYSTEM_PROMPT,
      input: { sentence: cleaned },
      schema: PERSONA_SCHEMA,
      schemaName: "persona_v1",
      model,
      temperature: config.temperature,
      timeoutMs: config.timeoutMs,
    });
    const { persona, flags } = sanitizePersona(res.output);
    return {
      status: "ok",
      persona,
      personaHash: hashJson(persona),
      limits: clampLimits({
        maxPerCoinBps: res.output.max_per_coin_pct * 100,
        maxTradesPerDay: res.output.max_trades_per_day,
      }),
      flags,
      log: { ...log, model: res.model, temperature: res.temperature, raw: res.raw, usage: res.usage, attempts: res.attempts },
    };
  } catch (e) {
    if (!(e instanceof LlmError)) throw e;
    return { status: "invalid", error: `${e.kind}: ${e.message}`, log: { ...log, raw: e.raw ?? null } };
  }
}

export function cleanSentence(sentence: string): string {
  // The slice only bounds the regex work on a hostile, huge input.
  const text = oneLine(stripUrls(sentence.slice(0, 2000)));
  return [...text].slice(0, MAX_SENTENCE_CHARS).join("").trim();
}

/** The same bounds `BotRegistry` enforces. Use it for user slider edits too. */
export function clampLimits(limits: BotLimits): BotLimits {
  const { perCoinBps: coin, tradesPerDay: trades } = LIMITS;
  return {
    maxPerCoinBps: clamp(Math.round(limits.maxPerCoinBps / coin.step) * coin.step, coin.min, coin.max),
    maxTradesPerDay: clamp(Math.round(limits.maxTradesPerDay), trades.min, trades.max),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Number.isNaN(value) ? min : Math.min(max, Math.max(min, value));
}

const NEUTRAL: Persona = {
  name: "Rookie Bot",
  emoji: "🤖",
  persona: "A calm bot still finding its style.",
  rules: "Trades carefully inside the limits on its card.",
};

/** The schema can't express "no URLs", "one emoji" or "not blank", so they are fixed up here and flagged. */
export function sanitizePersona(output: Persona): { persona: Persona; flags: PersonaFlag[] } {
  const flags: PersonaFlag[] = [];
  const persona = { ...NEUTRAL };

  for (const field of ["name", "persona", "rules"] as const) {
    let text = oneLine(output[field]);
    if (containsUrl(text)) {
      flags.push({ field, rule: "url" });
      text = oneLine(stripUrls(text));
    }
    if (text) persona[field] = text;
    else flags.push({ field, rule: "empty" });
  }

  if (isOneEmoji(output.emoji.trim())) persona.emoji = output.emoji.trim();
  else flags.push({ field: "emoji", rule: "not_an_emoji" });

  return { persona, flags };
}

function oneLine(text: string): string {
  return text.replace(/[\p{Cc}\s]+/gu, " ").trim();
}

function isOneEmoji(text: string): boolean {
  // Length bound: a single grapheme can carry any number of combining marks.
  if ([...text].length > 12 || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text)) return false;
  return [...new Intl.Segmenter().segment(text)].length === 1;
}
