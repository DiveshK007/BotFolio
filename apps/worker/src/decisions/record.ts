import type { DecisionCallResult } from "../decision/call";
import { wantsDailyCall } from "../decision/call";
import type { DecisionInput } from "../decision/input";
import { hashJson } from "../canonical";
import { gate } from "../gate/gate";
import type { GateInput, GateResult } from "../gate/types";
import type { HouseOutput } from "../house/schema";
import { HOUSE_MODEL, HOUSE_RULES_VERSION } from "../house/strategies";
import type { OracleReading } from "../oracle";
import type { Queryable } from "../scheduler/db";
import type { Slot } from "../scheduler/slots";
import { exactJsonb, pgSafeText, publicJson } from "./json";
import { storeGateInput, storeRounds, type StoredGateInput, type StoredRound } from "./replay";
import { callsCloseAt } from "./secrecy";

/** SPEC §6.5 logs the parameters sent, and §6.6 the tokens. */
export interface LlmMeta {
  schemaName: string;
  promptHash: string;
  temperature: number | null;
  attempts: number | null;
  inTok: number | null;
  /** null also on Daily Call decisions: the count varies with the bot's secret answer. */
  outTok: number | null;
}

/** `decisions.gate_result`. Public through site_decisions, so nothing secret may ever go in. */
export interface StoredGateResult extends GateResult {
  replay: { input: StoredGateInput; rounds: StoredRound[] };
  /** null = no LLM was called (house bot, budget hold). */
  llm: LlmMeta | null;
}

/** A decision that has been made and gated, ready to be written. */
export interface DecisionRecord {
  id: string;
  botId: bigint;
  version: number;
  slot: Pick<Slot, "id" | "kind" | "time">;
  promptVersion: string;
  model: string;
  input: unknown;
  rawOutput: unknown;
  secretHash: boolean;
  reason: string | null;
  result: GateResult;
  gateInput: GateInput;
  readings: readonly OracleReading[];
  llm: LlmMeta | null;
}

interface Made {
  id: string;
  version: number;
  slot: Pick<Slot, "id" | "kind" | "time">;
  gateInput: GateInput;
  readings: readonly OracleReading[];
  rulesVersion: string;
}

/** An LLM bot's decision: gated, with what of it may be public already worked out. */
export function llmDecision(made: Made, call: DecisionCallResult): DecisionRecord {
  const { log } = call;
  const result = gate(made.gateInput, call.output, made.rulesVersion);
  const askedLlm = !(call.status === "ok" && call.source === "budget_hold");
  // A budget hold has no view in it, so it has nothing to hide.
  const secret = askedLlm && wantsDailyCall(made.slot);

  return {
    ...made,
    botId: made.gateInput.bot.botId,
    promptVersion: log.promptVersion,
    model: log.model,
    input: log.inputJson satisfies DecisionInput,
    rawOutput: log.rawOutputJson,
    secretHash: secret,
    reason: result.output?.reason ?? (call.status === "invalid" ? call.reason : null),
    result,
    llm: askedLlm
      ? {
          schemaName: log.schemaName,
          promptHash: log.promptHash,
          temperature: log.temperature ?? null,
          attempts: log.attempts,
          inTok: log.usage?.inTok ?? null,
          outTok: secret ? null : (log.usage?.outTok ?? null),
        }
      : null,
  };
}

/** A house bot's decision. Its input is what the rules looked at. */
export function houseRecord(made: Made, output: HouseOutput, input: unknown): DecisionRecord {
  const result = gate(made.gateInput, output, made.rulesVersion);
  return {
    ...made,
    botId: made.gateInput.bot.botId,
    promptVersion: HOUSE_RULES_VERSION,
    model: HOUSE_MODEL,
    input,
    rawOutput: output,
    secretHash: false,
    reason: result.output?.reason ?? null,
    result,
    llm: null,
  };
}

/**
 * Writes the decision. False = this bot already has one for this slot, and that one stands (SPEC §6.1: idempotent
 * by slot): send nothing for this one.
 *
 * input_hash and output_hash are keccak256 of canonical JSON (SPEC §6.5).
 */
export async function saveDecision(db: Queryable, record: DecisionRecord, now: Date): Promise<boolean> {
  const { result, rawOutput } = record;
  const gateResult: StoredGateResult = {
    ...result,
    replay: { input: storeGateInput(record.gateInput), rounds: storeRounds(record.readings) },
    llm: record.llm,
  };
  const noOutput = rawOutput === null || rawOutput === undefined;
  const held = record.secretHash && callsCloseAt(record.slot.time) > now;

  const { rows } = await db.query(
    `insert into decisions
       (id, bot_id, version, slot_id, prompt_version, model, input_json, input_hash, raw_output_json, output_hash,
        gate_result, reason, reason_tag, roast, status)
     values ($1::uuid, $2::bigint, $3::int, $4::bigint, $5::text, $6::text, $7::jsonb, decode($8::text, 'hex'),
             $9::jsonb, decode($10::text, 'hex'), $11::jsonb, $12::text, $13::text, $14::text, $15::decision_status)
     on conflict (bot_id, slot_id) do nothing
     returning id`,
    [
      record.id,
      record.botId.toString(),
      record.version,
      record.slot.id,
      record.promptVersion,
      record.model,
      exactJsonb(record.input),
      hashJson(record.input).slice(2),
      noOutput ? null : exactJsonb(rawOutput),
      noOutput || held ? null : hashJson(rawOutput).slice(2),
      JSON.stringify(publicJson(gateResult)),
      record.reason === null ? null : pgSafeText(record.reason),
      result.output?.reason_tag ?? null,
      result.output ? pgSafeText(result.output.roast) : null,
      result.status,
    ],
  );
  return rows.length === 1;
}

/**
 * The slot's oracle reads (SPEC §5.6): the latest valid answer per asset. An unreadable feed keeps the row it
 * has. A decision's own rounds are in its gate_result, because a +5 min retry can see a newer one.
 */
export async function saveOracleReads(db: Queryable, slotId: string, readings: readonly OracleReading[]): Promise<void> {
  for (const r of readings) {
    if (!r.valid) continue;
    await db.query(
      `insert into oracle_reads (slot_id, asset, feed, round_id, answer, updated_at, fresh)
       values ($1::bigint, $2::asset_id, $3::text, $4::numeric, $5::numeric, to_timestamp($6::float8), $7::boolean)
       on conflict (slot_id, asset) do update set
         round_id = excluded.round_id, answer = excluded.answer, updated_at = excluded.updated_at, fresh = excluded.fresh
       where excluded.updated_at >= oracle_reads.updated_at`,
      [slotId, r.asset, r.feed.toLowerCase(), r.roundId, r.priceE8, r.updatedAt, r.fresh],
    );
  }
}
