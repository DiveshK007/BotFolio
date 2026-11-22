import type { GateOrder } from "../gate/types";
import { ASSET_IDS } from "../interfaces";
import type { RunnerDeps } from "./deps";
import type { Market } from "./market";
import { plannedOrders, type StoredDecision } from "./stored";

/** About 3.4M gas (docs/gas.md: 40k + 83k per order). */
export const MAX_ORDERS_PER_BATCH = 40;

/**
 * Sends what was decided and isn't on-chain yet.
 *
 * The chain says what is done: an executed order has used its orderId, and one the ledger skipped as stale
 * hasn't, so a retry sends it again under the same id. A send with an unknown outcome is safe to repeat for
 * the same reason (the second is skipped as USED).
 */
export async function deliver(
  deps: Pick<RunnerDeps, "chain" | "log">,
  decisions: readonly StoredDecision[],
  market: Pick<Market, "prices">,
): Promise<{ sent: number; failedBots: Set<bigint> }> {
  const tradable = decisions
    .flatMap(plannedOrders)
    .filter((order) => market.prices[ASSET_IDS[order.asset]!].fresh);
  const used = await Promise.all(tradable.map((order) => deps.chain.orderUsed(order.orderId)));
  const due = tradable.filter((_, i) => !used[i]);

  const failedBots = new Set<bigint>();
  let sent = 0;
  for (const batch of batches(due)) {
    try {
      const txHash = await deps.chain.executeBatch(batch);
      sent += batch.length;
      deps.log.info("runner.batch_sent", { orders: batch.length, txHash });
    } catch (error) {
      for (const order of batch) failedBots.add(order.botId);
      deps.log.warn("runner.batch_failed", { orders: batch.length, error: error instanceof Error ? error.name : "unknown" });
    }
  }
  return { sent, failedBots };
}

/** Keeps a bot's orders in one batch and in their order: the second BUY spends what the first left. */
export function batches(orders: readonly GateOrder[], max = MAX_ORDERS_PER_BATCH): GateOrder[][] {
  const byBot = new Map<bigint, GateOrder[]>();
  for (const order of orders) byBot.set(order.botId, [...(byBot.get(order.botId) ?? []), order]);

  const out: GateOrder[][] = [];
  let current: GateOrder[] = [];
  for (const group of byBot.values()) {
    if (current.length > 0 && current.length + group.length > max) {
      out.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length > 0) out.push(current);
  return out;
}
