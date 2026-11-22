import { readExact, publicJson } from "../decisions/json";
import { storeGateInput, storeRounds } from "../decisions/replay";
import { gate } from "../gate/gate";
import type { HouseOutput } from "../house/schema";
import { houseDecision, type HouseStrategy } from "../house/strategies";
import { ASSET_IDS } from "../interfaces";
import type { Slot } from "../scheduler/slots";
import { gateInputFor } from "./decide";
import { GATE_RULES_VERSION, type RunnerDeps } from "./deps";
import type { Market } from "./market";
import { prepareBigMoves } from "./signed";
import { plannedOrders, residual, staleIndexes, type StoredDecision, type StoredRetry } from "./stored";

/**
 * +5, +10, +15 min (SPEC §5 rule 4): gates the stale actions again at the new prices, under the same decisionId
 * and action index, so the same orderId. Nothing calls the LLM again. Still stale after the last one = hold.
 */
export async function retryStale(
  deps: RunnerDeps,
  slot: Slot,
  attempt: number,
  decision: StoredDecision,
  market: Market,
): Promise<boolean> {
  const { gateResult, botId, id } = decision;
  if (gateResult.retries?.some((retry) => retry.attempt >= attempt)) return false;
  const waiting = staleIndexes(decision);
  if (waiting.length === 0) return false;

  const raw = readExact(decision.raw) as { actions: { asset: (typeof ASSET_IDS)[number] }[] };
  if (!waiting.some((i) => market.prices[raw.actions[i]!.asset].fresh)) return false; // nothing has changed

  const now = deps.now();
  const state = await deps.chain.state(botId, Math.floor(now.getTime() / 1000));
  if (!state.bot.active) return false;

  let output: HouseOutput | null = null;
  if (state.bot.house) {
    // Sized again: the first sizes assumed the stale assets wouldn't trade.
    const input = readExact(decision.input) as {
      strategy: HouseStrategy;
      seasonStart: string | null;
      chg24hPct: Record<string, number | null>;
    };
    output = houseDecision({
      strategy: input.strategy,
      slot,
      seasonStart: input.seasonStart ? new Date(input.seasonStart) : null,
      portfolio: state.portfolio,
      prices: market.prices,
      chg24hPct: input.chg24hPct,
      alreadyTraded: plannedOrders(decision).map((order) => ASSET_IDS[order.asset]!),
    });
  }

  const input = gateInputFor(deps, id, botId, state, market, now);
  const result = gate(input, residual(output ?? raw, waiting), gateResult.rulesVersion ?? GATE_RULES_VERSION);
  const retry: StoredRetry = {
    attempt,
    indexes: waiting,
    input: storeGateInput(input),
    rounds: storeRounds(market.readings),
    output,
    result: { orders: result.orders, bigMoves: result.bigMoves, events: result.events },
  };

  const writeMoves = await prepareBigMoves(deps, id, result.bigMoves);
  await deps.db.transaction(async (tx) => {
    await tx.query(
      `update decisions
       set gate_result = jsonb_set(gate_result, '{retries}',
                                   coalesce(gate_result -> 'retries', '[]'::jsonb) || jsonb_build_array($2::jsonb)),
           status = case when $3::boolean then 'executed'::decision_status else status end
       where id = $1::uuid`,
      [id, JSON.stringify(publicJson(retry)), result.orders.length > 0],
    );
    await writeMoves(tx);
  });
  deps.log.info("runner.retried", { decision: id, botId, attempt, orders: result.orders.length });
  return true;
}
