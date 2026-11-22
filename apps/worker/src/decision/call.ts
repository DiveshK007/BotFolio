import { LlmError, type BudgetState, type LlmClient, type LlmConfig, type LlmUsage } from "@botfolio/llm";
import type { Hex } from "viem";
import { hashJson } from "../canonical";
import { isNineAmSlot } from "../ist";
import type { DecisionInput } from "./input";
import { decisionPrompt } from "./prompt";
import { decisionSchemaFor, type DecisionOutput } from "./schema";

/** SPEC §6.4.1: the 09:00 slot and the debut decision also return the bot's Daily Call view. */
export function wantsDailyCall(slot: { kind: "scheduled" | "debut"; time: Date }): boolean {
  return slot.kind === "debut" || isNineAmSlot(slot.time);
}

/** Logged as the model when the budget is used up and no LLM was called. */
export const BUDGET_HOLD_MODEL = "budget-hold";

/** Everything the `decisions` row needs from the call, plus what the server log shows. */
export interface DecisionLog {
  promptVersion: string;
  promptHash: Hex;
  schemaName: string;
  model: string;
  temperature: number | undefined;
  attempts: number | null;
  usage: LlmUsage | null;
  inputJson: DecisionInput;
  inputHash: Hex;
  /** Parsed output; the raw text if that wasn't JSON; null if nothing came back. */
  // TODO(#49): Postgres jsonb refuses NUL characters and lone surrogates; escape them when writing the row.
  rawOutputJson: unknown;
  outputHash: Hex | null;
  error: string | null;
}

export type DecisionCallResult =
  | { status: "ok"; source: "llm" | "budget_hold"; output: DecisionOutput; log: DecisionLog }
  /** Both attempts failed. Record `invalid` and hold. `reason` is the line to show, so the slot is never blank. */
  | { status: "invalid"; output: null; reason: string; log: DecisionLog };

export interface DecisionCallOptions {
  llm: LlmClient;
  config: Pick<LlmConfig, "models" | "temperature" | "timeoutMs" | "promptVersion">;
  input: DecisionInput;
  slot: { kind: "scheduled" | "debut"; time: Date };
  /** `resting` skips the LLM (SPEC §6.6). */
  budget: BudgetState;
  /** One line per call, without the input. Defaults to stdout (Render logs). */
  logLine?: (line: string) => void;
}

/**
 * The decision call (SPEC §6.2–6.3, §6.4.1). The LLM client does the one retry of §6.4 step 1.
 * An LLM failure is a result, not an exception, so one bot can't stop the slot.
 */
export async function runDecisionCall(opts: DecisionCallOptions): Promise<DecisionCallResult> {
  const result = await decide(opts);
  (opts.logLine ?? console.log)(summary(result));
  return result;
}

async function decide({ llm, config, input, slot, budget }: DecisionCallOptions): Promise<DecisionCallResult> {
  const prompt = decisionPrompt(config.promptVersion);
  const withDailyCall = wantsDailyCall(slot);
  const schemaName = withDailyCall ? "decision_v1_daily_call" : "decision_v1";
  const base: DecisionLog = {
    promptVersion: prompt.version,
    promptHash: prompt.hash,
    schemaName,
    model: config.models.decision,
    temperature: config.temperature,
    attempts: null,
    usage: null,
    inputJson: input,
    inputHash: hashJson(input),
    rawOutputJson: null,
    outputHash: null,
    error: null,
  };

  if (budget === "resting") {
    const output: DecisionOutput = {
      actions: [],
      reason: `${shortName(input.bot.name)} is resting this slot. Holding until it's back.`,
      reason_tag: "stay_cash",
      roast: "",
    };
    return {
      status: "ok",
      source: "budget_hold",
      output,
      log: { ...base, model: BUDGET_HOLD_MODEL, temperature: undefined, rawOutputJson: output, outputHash: hashJson(output) },
    };
  }

  try {
    const res = await llm.complete<DecisionOutput>({
      system: prompt.system,
      input,
      schema: decisionSchemaFor(withDailyCall),
      schemaName,
      model: config.models.decision,
      temperature: config.temperature,
      timeoutMs: config.timeoutMs,
    });
    return {
      status: "ok",
      source: "llm",
      output: res.output,
      log: {
        ...base,
        model: res.model,
        temperature: res.temperature,
        attempts: res.attempts,
        usage: res.usage,
        rawOutputJson: res.output,
        outputHash: hashJson(res.output),
      },
    };
  } catch (e) {
    if (!(e instanceof LlmError)) throw e;
    const { rawOutputJson, outputHash } = logRaw(e.raw);
    return {
      status: "invalid",
      output: null,
      reason: `${shortName(input.bot.name)} lost its train of thought, so it's holding this slot.`,
      log: { ...base, rawOutputJson, outputHash, error: `${e.kind}: ${e.message}` },
    };
  }
}

function shortName(name: string): string {
  return [...name].slice(0, 20).join("") || "Your bot";
}

function logRaw(raw: string | undefined): { rawOutputJson: unknown; outputHash: Hex | null } {
  if (raw === undefined) return { rawOutputJson: null, outputHash: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    return { rawOutputJson: parsed, outputHash: hashJson(parsed) };
  } catch {
    // Not JSON, or not canonical JSON (1e999 parses to Infinity): keep the text itself.
    return { rawOutputJson: raw, outputHash: hashJson(raw) };
  }
}

function summary({ status, log }: DecisionCallResult): string {
  return JSON.stringify({
    event: "llm.decision",
    status,
    promptVersion: log.promptVersion,
    promptHash: log.promptHash,
    schemaName: log.schemaName,
    model: log.model,
    temperature: log.temperature ?? null,
    attempts: log.attempts,
    usage: log.usage,
    inputHash: log.inputHash,
    outputHash: log.outputHash,
    error: log.error,
  });
}
