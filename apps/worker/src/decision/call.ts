import { LlmError, type BudgetState, type LlmClient, type LlmConfig, type LlmUsage } from "@botfolio/llm";
import type { AssetId } from "@botfolio/shared";
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

const DAILY_CALL_SCHEMA_NAME = "decision_v1_daily_call";

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
  /**
   * With a Daily Call view, this and `rawOutputJson` are secret until the user picks (SPEC §6.4.1): the
   * rest of the output is public, so the hash gives btc_up away to anyone who can guess `why`.
   */
  // TODO(#49): site_decisions publishes output_hash, so don't write it for these decisions before the pick.
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
  const schemaName = withDailyCall ? DAILY_CALL_SCHEMA_NAME : "decision_v1";
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
      schema: decisionSchemaFor(withDailyCall, debutAssets(slot, input)),
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

/**
 * #219 item 18: the debut is the newcomer's first trade and has no stale retry, and SOL, XRP and Gold are often
 * too old. So its request only offers the assets the input marks fresh (usually BTC and ETH), and structured
 * output keeps the model to them. Derived from the logged input, so nothing extra needs logging. With nothing
 * fresh the full list stays: nothing can trade anyway, and an empty enum isn't a schema.
 */
export function debutAssets(slot: { kind: "scheduled" | "debut" }, input: DecisionInput): AssetId[] | undefined {
  return slot.kind === "debut" ? input.market.filter((m) => m.fresh).map((m) => m.asset) : undefined;
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

/**
 * The server log line. When the request asked for a Daily Call view, nothing computed from the model's
 * output goes in it: no hash, no output token count, and only the kind of an error (messages quote keys
 * the model wrote).
 */
function summary({ status, log }: DecisionCallResult): string {
  const secret = log.schemaName === DAILY_CALL_SCHEMA_NAME;
  return JSON.stringify({
    event: "llm.decision",
    status,
    promptVersion: log.promptVersion,
    promptHash: log.promptHash,
    schemaName: log.schemaName,
    model: log.model,
    temperature: log.temperature ?? null,
    attempts: log.attempts,
    usage: secret && log.usage ? { inTok: log.usage.inTok } : log.usage,
    inputHash: log.inputHash,
    outputHash: secret ? null : log.outputHash,
    error: secret && log.error ? log.error.split(":")[0] : log.error,
  });
}
