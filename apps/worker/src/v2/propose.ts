import { LlmError, type LlmClient, type LlmConfig, type LlmUsage } from "@botfolio/llm";
import type { Hex } from "viem";
import { hashJson } from "../canonical";
import { pgSafeText } from "../decisions/json";
import { clampLimits } from "../persona/persona";
import { LIMITS } from "../persona/schema";
import { bannedRules } from "../text/content-filter";
import { containsUrl, stripUrls } from "../text/urls";
import { V2_PROMPT_HASH, V2_PROMPT_VERSION, V2_SYSTEM_PROMPT } from "./prompt";
import { MAX_CHANGES, V2_SCHEMA, type V2Output } from "./schema";

/** Proposals made without the model (it failed, proposed no change, or the budget is resting). */
export const V2_FALLBACK_VERSION = "v2-fallback-v1";

export interface V2Correction {
  id: number;
  chip: string;
  note: string | null;
}

export interface V2Input {
  botId: bigint;
  season: number;
  /** 08:30 IST the morning after the close (SPEC §2.3): after that the bot keeps its version. */
  approveBy: Date;
  name: string;
  persona: string;
  current: { version: number; rules: string; maxPerCoinBps: number; maxTradesPerDay: number };
  results: { returnBps: number; maxDdBps: number; trades: number; battleRank: number | null };
  /** Newest first. */
  corrections: V2Correction[];
}

export interface V2Change {
  what: string;
  /** 0 = from the season's results, no correction behind it. */
  because_correction_id: number;
}

/** What the owner approves. `commitVersion` commits `hashJson(config)`, so every field here is covered. */
export interface V2Config {
  bot_id: string;
  version: number;
  season: number;
  rules: string;
  max_per_coin_bps: number;
  max_trades_per_day: number;
  from: { version: number; rules: string; max_per_coin_bps: number; max_trades_per_day: number };
  changes: V2Change[];
  proposed_by: { model: string; prompt_version: string; prompt_hash: Hex | null };
  approve_by: string;
}

export interface V2Proposal {
  config: V2Config;
  configHash: Hex;
  /** Why the fallback was used, if it was. */
  fallback: "llm_error" | "no_change" | "resting" | "no_llm" | null;
  log: { raw: string | null; usage: LlmUsage | null; error: string | null };
}

export interface V2Options {
  llm: LlmClient | null;
  config: Pick<LlmConfig, "models" | "temperature" | "timeoutMs">;
  resting: boolean;
  input: V2Input;
}

// Control characters go; NUL and lone surrogates too, so the jsonb row hashes like the config it holds.
const oneLine = (text: string) => pgSafeText(text).replace(/[\p{Cc}\s]+/gu, " ").trim();

/** A line the model wrote, or null if it can't be shown: blank, or banned content. URLs are cut out. */
function clean(text: string): string | null {
  const line = oneLine(containsUrl(text) ? stripUrls(text) : text);
  return line && bannedRules(line).length === 0 ? line : null;
}

/** SPEC §2.3 step 3: corrections (or results) and the current version → the next version, with a diff. */
export async function proposeV2({ llm, config, resting, input }: V2Options): Promise<V2Proposal> {
  if (!llm) return fallbackProposal(input, "no_llm", null);
  if (resting) return fallbackProposal(input, "resting", null);

  const model = config.models.v2;
  try {
    const res = await llm.complete<V2Output>({
      system: V2_SYSTEM_PROMPT,
      input: modelInput(input),
      schema: V2_SCHEMA,
      schemaName: "v2_proposal_v1",
      model,
      temperature: config.temperature,
      timeoutMs: config.timeoutMs,
    });
    const log = { raw: res.raw, usage: res.usage, error: null };
    const proposal = fromOutput(input, res.output, { model: res.model, prompt_version: V2_PROMPT_VERSION, prompt_hash: V2_PROMPT_HASH });
    return proposal ? { ...proposal, fallback: null, log } : { ...fallbackProposal(input, "no_change", null), log };
  } catch (e) {
    if (!(e instanceof LlmError)) throw e;
    return fallbackProposal(input, "llm_error", `${e.kind}: ${e.message}`);
  }
}

/** What the model sees. Percentages, as the prompt speaks of them. */
function modelInput(input: V2Input): object {
  const { current, results } = input;
  return {
    bot: { name: input.name, persona: input.persona },
    current: {
      version: current.version,
      rules: current.rules,
      max_per_coin_pct: current.maxPerCoinBps / 100,
      max_trades_per_day: current.maxTradesPerDay,
    },
    season: {
      number: input.season,
      return_pct: results.returnBps / 100,
      max_drawdown_pct: results.maxDdBps / 100,
      trades: results.trades,
      rank_vs_house_bots: results.battleRank,
    },
    corrections: input.corrections.map((c) => ({ id: c.id, chip: c.chip, note: c.note ?? "" })),
  };
}

function build(input: V2Input, next: { rules: string; maxPerCoinBps: number; maxTradesPerDay: number }, changes: V2Change[], proposedBy: V2Config["proposed_by"]): Omit<V2Proposal, "fallback" | "log"> {
  const { current } = input;
  const config: V2Config = {
    bot_id: input.botId.toString(),
    version: current.version + 1,
    season: input.season,
    rules: next.rules,
    max_per_coin_bps: next.maxPerCoinBps,
    max_trades_per_day: next.maxTradesPerDay,
    from: { version: current.version, rules: current.rules, max_per_coin_bps: current.maxPerCoinBps, max_trades_per_day: current.maxTradesPerDay },
    changes,
    proposed_by: proposedBy,
    approve_by: input.approveBy.toISOString(),
  };
  return { config, configHash: hashJson(config) };
}

/**
 * The model's proposal after the checks the schema can't make, or null if nothing in it changes. Rules with
 * banned content keep the current text; a change line that is banned, or names a correction that isn't this
 * bot's this season, is dropped.
 */
export function fromOutput(input: V2Input, output: V2Output, proposedBy: V2Config["proposed_by"]) {
  const { current } = input;
  const rules = clean(output.rules) ?? current.rules;
  const limits = clampLimits({ maxPerCoinBps: output.max_per_coin_pct * 100, maxTradesPerDay: output.max_trades_per_day });
  const ids = new Set(input.corrections.map((c) => c.id));
  const changes: V2Change[] = [];
  for (const change of output.changes.slice(0, MAX_CHANGES)) {
    const what = clean(change.what);
    const id = change.because_correction_id;
    if (what && (id === 0 || ids.has(id))) changes.push({ what: what.slice(0, 100), because_correction_id: id });
  }
  const changed = rules !== current.rules || limits.maxPerCoinBps !== current.maxPerCoinBps || limits.maxTradesPerDay !== current.maxTradesPerDay;
  if (!changed || changes.length === 0) return null;
  return build(input, { rules, ...limits }, changes, proposedBy);
}

const pct = (bps: number) => `${Number((bps / 100).toFixed(2))} %`;

/**
 * A deterministic proposal: one step on one slider. The chip cited most ("too risky" or "too timid") decides the
 * direction; without corrections, a loss or a drawdown of 10 % or more means more careful, otherwise bolder.
 * The max per coin moves 5 points; at its bound, trades per day move 1 instead.
 */
export function fallbackProposal(input: V2Input, why: NonNullable<V2Proposal["fallback"]>, error: string | null): V2Proposal {
  const { current, results, corrections } = input;
  const cited = (chip: string) => corrections.filter((c) => c.chip === chip);
  const risky = cited("too risky");
  const timid = cited("too timid");

  let careful: boolean;
  let reason: string;
  let id = 0;
  if (risky.length !== timid.length) {
    careful = risky.length > timid.length;
    const chips = careful ? risky : timid;
    reason = `You said '${careful ? "too risky" : "too timid"}' ${chips.length}×`;
    id = chips[0]!.id;
  } else if (results.returnBps < 0 || results.maxDdBps >= 1000) {
    careful = true;
    reason = results.maxDdBps >= 1000 ? `Drawdown reached ${pct(results.maxDdBps)}` : `Season return ${pct(results.returnBps)}`;
  } else {
    careful = false;
    reason = `Season return +${pct(results.returnBps)} with drawdown ${pct(results.maxDdBps)}`;
  }

  const { perCoinBps, tradesPerDay } = LIMITS;
  const step = careful ? -perCoinBps.step : perCoinBps.step;
  const coin = Math.min(perCoinBps.max, Math.max(perCoinBps.min, current.maxPerCoinBps + step));
  let next = { rules: current.rules, maxPerCoinBps: coin, maxTradesPerDay: current.maxTradesPerDay };
  let what = `${reason} → max per coin ${pct(current.maxPerCoinBps)} → ${pct(coin)}`;
  if (coin === current.maxPerCoinBps) {
    const trades = Math.min(tradesPerDay.max, Math.max(tradesPerDay.min, current.maxTradesPerDay + (careful ? -1 : 1)));
    next = { ...next, maxTradesPerDay: trades };
    what = trades === current.maxTradesPerDay
      ? `${reason}, but the limits are already at their ${careful ? "most careful" : "boldest"}`
      : `${reason} → trades per day ${current.maxTradesPerDay} → ${trades}`;
  }
  const proposal = build(input, next, [{ what: what.slice(0, 100), because_correction_id: id }], {
    model: "fallback",
    prompt_version: V2_FALLBACK_VERSION,
    prompt_hash: null,
  });
  return { ...proposal, fallback: why, log: { raw: null, usage: null, error } };
}
