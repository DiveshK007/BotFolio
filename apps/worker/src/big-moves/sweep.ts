import type { AssetId } from "@botfolio/shared";
import { decisionIdFromUuid } from "@botfolio/shared";
import type { Hex } from "viem";
import { publicJson } from "../decisions/json";
import { storeGateInput, storeRounds } from "../decisions/replay";
import { shrinkBigMove, type ShrinkResult } from "../gate/shrink";
import type { GateOrder, Portfolio } from "../gate/types";
import { ASSET_INDEX, type ApprovedOrder } from "../interfaces";
import { errorLabel } from "../scheduler/log";
import { batches } from "../slot/deliver";
import type { RunnerDeps } from "../slot/deps";
import { readMarket } from "../slot/run";

/**
 * SPEC §5 rule 4 for an expired big move whose price is too old: try again on the next sweeps, then give up and
 * hold. With a sweep every 10 min that is two or three more looks.
 */
export const STALE_GIVE_UP_SECONDS = 20 * 60;

interface PendingMove {
  id: string;
  decision: string;
  botId: bigint;
  asset: AssetId;
  buy: boolean;
  bps: number;
  actionIndex: number;
  orderId: Hex;
  deadline: number;
}

type Status = "approved" | "shrunk" | "expired";

/**
 * Every 10 min (SPEC §6.1, §6.4 step 10): a big move still pending at its deadline is shrunk to just under the
 * threshold and executed under the same orderId, so PaperLedger can't run it twice (the owner's Allow and this).
 *
 * "Past the deadline" is judged by the chain's latest block, as `executeApproved` judges it. Each shrink is
 * written to its decision's `gate_result.shrinks` before it is sent, so a replay can recompute it.
 */
export async function sweepBigMoves(deps: RunnerDeps, signal: AbortSignal): Promise<{ shrunk: number; expired: number }> {
  const { db, chain, log } = deps;
  const chainNow = await chain.chainSeconds();
  const { rows } = await db.query<{
    id: string;
    decision: string;
    bot_id: string;
    asset: AssetId;
    side: "BUY" | "SELL";
    bps: number;
    action_index: number;
    order_id: string;
    deadline: string;
  }>(
    `select id::text as id, decision_id::text as decision, bot_id::text as bot_id, asset::text as asset,
            side::text as side, bps, action_index, '0x' || encode(order_id, 'hex') as order_id,
            extract(epoch from deadline)::bigint::text as deadline
     from big_moves where status = 'pending' and deadline < to_timestamp($1::float8)
     order by bot_id, created_at, id`,
    [chainNow],
  );
  const moves: PendingMove[] = rows.map((r) => ({
    id: r.id,
    decision: r.decision,
    botId: BigInt(r.bot_id),
    asset: r.asset,
    buy: r.side === "BUY",
    bps: r.bps,
    actionIndex: r.action_index,
    orderId: r.order_id as Hex,
    deadline: Number(r.deadline),
  }));
  if (moves.length === 0) return { shrunk: 0, expired: 0 };

  const market = await readMarket(deps, null);
  const setStatus = (move: PendingMove, status: Status) =>
    db.query("update big_moves set status = $2::big_move_status where id = $1::bigint and status = 'pending'", [move.id, status]);

  const toSend: { move: PendingMove; order: GateOrder }[] = [];
  let expired = 0;
  // One bot's moves in order: each shrink is sized after the ones before it.
  const byBot = new Map<bigint, PendingMove[]>();
  for (const move of moves) byBot.set(move.botId, [...(byBot.get(move.botId) ?? []), move]);

  for (const [botId, list] of byBot) {
    if (signal.aborted) break;
    try {
      const state = await chain.state(botId, chainNow);
      let portfolio: Portfolio = state.portfolio;
      let tradesToday = state.tradesToday;
      for (const move of list) {
        // Used without a shrink of ours: the owner's Allow got there first. The indexer adds its tx.
        if (await chain.orderUsed(move.orderId)) {
          await setStatus(move, (await shrinkLogged(deps, move)) ? "shrunk" : "approved");
          continue;
        }
        const pending: ApprovedOrder = {
          botId,
          asset: ASSET_INDEX[move.asset],
          buy: move.buy,
          bps: move.bps,
          decisionId: decisionIdFromUuid(move.decision),
          actionIndex: move.actionIndex,
          deadline: BigInt(move.deadline),
        };
        const bot = {
          botId,
          active: state.bot.active,
          isHouse: state.bot.house,
          maxPerCoinBps: state.bot.maxPerCoinBps,
          maxTradesPerDay: state.bot.maxTradesPerDay,
          tradesToday,
        };
        const input = { bot, portfolio, prices: market.prices, nowSeconds: chainNow, bigMove: deps.bigMove };
        const result = shrinkBigMove({ ...input, pending, orderUsed: false, trigger: "expired" });

        if (result.outcome === "execute") {
          await logShrink(deps, move, { ...input, decisionId: pending.decisionId }, market.readings, result);
          toSend.push({ move, order: result.order });
          portfolio = result.portfolioAfter;
          tradesToday = result.tradesTodayAfter;
        } else if (result.outcome === "drop" || (result.outcome === "stale" && chainNow > move.deadline + STALE_GIVE_UP_SECONDS)) {
          await setStatus(move, "expired");
          expired++;
        }
        // "stale" inside the window and "not_due" stay pending for the next sweep.
      }
    } catch (error) {
      log.warn("big_moves.bot_failed", { botId, error: errorLabel(error) });
    }
  }

  let shrunk = 0;
  for (const batch of batches(toSend.map((s) => s.order))) {
    try {
      await chain.executeBatch(batch);
    } catch (error) {
      log.warn("big_moves.batch_failed", { orders: batch.length, error: errorLabel(error) });
    }
  }
  // The chain says what executed: a skipped order stays pending and is tried again, or expires.
  for (const { move } of toSend) {
    if (!(await chain.orderUsed(move.orderId).catch(() => false))) continue;
    await setStatus(move, "shrunk");
    await db.query("update decisions set status = 'executed' where id = $1::uuid", [move.decision]);
    shrunk++;
  }
  if (shrunk + expired > 0) log.info("big_moves.swept", { shrunk, expired });
  return { shrunk, expired };
}

async function shrinkLogged(deps: Pick<RunnerDeps, "db">, move: PendingMove): Promise<boolean> {
  const { rows } = await deps.db.query<{ logged: boolean }>(
    `select coalesce(gate_result -> 'shrinks', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('orderId', $2::text)) as logged
     from decisions where id = $1::uuid`,
    [move.decision, move.orderId],
  );
  return rows[0]?.logged ?? false;
}

/** Public like the rest of gate_result: the order, and the exact inputs to recompute it with shrinkBigMove. */
async function logShrink(
  deps: Pick<RunnerDeps, "db">,
  move: PendingMove,
  input: Parameters<typeof storeGateInput>[0],
  readings: Parameters<typeof storeRounds>[0],
  result: Extract<ShrinkResult, { outcome: "execute" }>,
): Promise<void> {
  const entry = {
    orderId: move.orderId,
    actionIndex: move.actionIndex,
    pending: { asset: move.asset, buy: move.buy, bps: move.bps, deadline: move.deadline },
    input: storeGateInput(input),
    rounds: storeRounds(readings),
    order: result.order,
  };
  await deps.db.query(
    `update decisions
     set gate_result = jsonb_set(gate_result, '{shrinks}', coalesce(gate_result -> 'shrinks', '[]'::jsonb) || jsonb_build_array($2::jsonb))
     where id = $1::uuid
       and not coalesce(gate_result -> 'shrinks', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('orderId', $3::text))`,
    [move.decision, JSON.stringify(publicJson(entry)), move.orderId],
  );
}
