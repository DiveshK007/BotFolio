import { estimateCostUsd, type BudgetState } from "@botfolio/llm";
import type { HealthState } from "../health";
import type { Queryable } from "../scheduler/db";
import type { Log } from "../scheduler/log";

/**
 * What a call is assumed to have used where the count isn't stored. Both err high, so bots rest early rather
 * than over budget: §6.6 measures about 1,500 input and 150 output tokens.
 *  - output: withheld on Daily Call decisions, and unknown after a failure.
 *  - input: unknown after a failure, so the input's bytes / 3 plus the system prompt.
 */
export const ASSUMED_OUTPUT_TOKENS = 400;
export const SYSTEM_PROMPT_TOKENS = 1000;
/** A failed call without a count had both tries. */
const MAX_ATTEMPTS = 2;

/** YYYY-MM-01 00:00 UTC: the month /healthz shows. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * This month's decision spend, from the logged decisions, so a restart can't reset the budget.
 * Persona and v2 calls have no table and aren't in it (SPEC §6.6 puts them under 10 %).
 */
export async function monthSpendUsd(db: Queryable, now: Date): Promise<number> {
  const { rows } = await db.query<{ model: string; in_tok: string; out_tok: string }>(
    `select model,
            coalesce(sum(attempts * in_tok), 0)::text as in_tok,
            coalesce(sum(attempts * out_tok), 0)::text as out_tok
     from (
       select model,
              coalesce((gate_result #>> '{llm,attempts}')::numeric, $2::numeric) as attempts,
              coalesce((gate_result #>> '{llm,inTok}')::numeric,
                       ceil(octet_length(input_json::text) / 3.0) + $3::numeric) as in_tok,
              coalesce((gate_result #>> '{llm,outTok}')::numeric, $4::numeric) as out_tok
       from decisions
       where created_at >= $1::timestamptz
         and jsonb_typeof(gate_result -> 'llm') = 'object'
     ) calls
     group by model`,
    [monthStart(now).toISOString(), MAX_ATTEMPTS, SYSTEM_PROMPT_TOKENS, ASSUMED_OUTPUT_TOKENS],
  );
  return rows.reduce(
    (usd, row) => usd + estimateCostUsd(row.model, { inTok: Number(row.in_tok), outTok: Number(row.out_tok) }),
    0,
  );
}

/**
 * Run before each slot. `resting` means the runner makes the deterministic hold instead of calling the LLM
 * (SPEC §6.6). The cap only ever comes from LLM_MONTHLY_BUDGET_USD (SPEC §15).
 */
export async function refreshBudget(db: Queryable, health: HealthState, log: Log, now: Date): Promise<BudgetState> {
  health.setLlmSpend(await monthSpendUsd(db, now), now);
  const state = health.budget(now);
  if (state === "alert" || state === "resting") log.warn("llm.budget", { state });
  return state;
}
