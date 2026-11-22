import type { Hex } from "viem";
import type { StoredGateResult } from "../decisions/record";
import type { StoredGateInput, StoredRound } from "../decisions/replay";
import type { DropReason, GateEvent, GateOrder, GateResult } from "../gate/types";
import type { HouseOutput } from "../house/schema";
import type { Queryable } from "../scheduler/db";

/**
 * A stale retry, appended to `gate_result.retries` (public, like the rest of it).
 *
 * To replay one: gate(input, residual(output ?? the decision's raw output, indexes)). An LLM decision's output
 * isn't repeated here, because the raw one holds the secret Daily Call view.
 */
export interface StoredRetry {
  attempt: number;
  /** The actions that were still waiting on a price. */
  indexes: number[];
  input: StoredGateInput;
  rounds: StoredRound[];
  /** House bots only: their sizes are worked out again on a retry. */
  output: HouseOutput | null;
  result: Pick<GateResult, "orders" | "bigMoves" | "events">;
}

/** Bigints are decimal strings in jsonb. */
type StoredOrder = Omit<GateOrder, "botId"> & { botId: string };
interface StoredResult {
  orders?: StoredOrder[];
  events?: GateEvent[];
}

export interface StoredDecision {
  id: string;
  botId: bigint;
  raw: unknown;
  input: unknown;
  gateResult: StoredResult & Partial<Pick<StoredGateResult, "rulesVersion">> & {
    retries?: { attempt: number; result: StoredResult }[];
  };
}

export async function decisionsOfSlot(db: Queryable, slotId: string): Promise<StoredDecision[]> {
  const { rows } = await db.query<{ id: string; bot_id: string; raw: unknown; input: unknown; gate_result: unknown }>(
    `select id::text as id, bot_id::text as bot_id, raw_output_json as raw, input_json as input, gate_result
     from decisions where slot_id = $1::bigint
     order by created_at, id`,
    [slotId],
  );
  return rows.map((row) => ({
    id: row.id,
    botId: BigInt(row.bot_id),
    raw: row.raw,
    input: row.input,
    gateResult: (row.gate_result ?? {}) as StoredDecision["gateResult"],
  }));
}

/** Every order the decision has been allowed, first gate and retries, in execution order. */
export function plannedOrders({ gateResult }: StoredDecision): GateOrder[] {
  const all = [...(gateResult.orders ?? []), ...(gateResult.retries ?? []).flatMap((r) => r.result.orders ?? [])];
  return all.map((order) => ({ ...order, botId: BigInt(order.botId), orderId: order.orderId as Hex }));
}

/** The actions whose only problem, at the last look, was a price too old. */
export function staleIndexes({ gateResult }: StoredDecision): number[] {
  const last = gateResult.retries?.at(-1)?.result ?? gateResult;
  const stale: DropReason = "stale";
  return (last.events ?? []).flatMap((e) => (e.kind === "drop" && e.reason === stale ? [e.actionIndex] : []));
}

/** The decision with every other action turned into HOLD, so each action keeps its index and so its orderId. */
export function residual(output: unknown, indexes: readonly number[]): unknown {
  const decision = output as { actions: { action: string }[] };
  return {
    ...decision,
    actions: decision.actions.map((action, i) => (indexes.includes(i) ? action : { ...action, action: "HOLD" })),
  };
}
