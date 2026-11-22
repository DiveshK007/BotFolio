import type { DecisionOutput } from "../decision/schema";
import type { BigMove } from "../gate/types";
import { ASSET_IDS } from "../interfaces";
import type { Queryable } from "../scheduler/db";
import { signApprovedOrder, signDailyCallView } from "../signing";
import type { RunnerDeps } from "./deps";

/** Signs each big move and returns the write for inside the decision's transaction (SPEC §6.4 step 9). */
export async function prepareBigMoves(
  deps: Pick<RunnerDeps, "runner" | "paperLedger">,
  decision: string,
  moves: readonly BigMove[],
): Promise<(tx: Queryable) => Promise<void>> {
  const signed = await Promise.all(
    moves.map(async (move) => ({ ...move, sig: await signApprovedOrder(deps.runner, deps.paperLedger, move.order) })),
  );
  return async (tx) => {
    for (const { order, orderId, sig } of signed) {
      await tx.query(
        `insert into big_moves (decision_id, action_index, order_id, bot_id, asset, side, bps, runner_sig, deadline)
         values ($1::uuid, $2::int, decode($3::text, 'hex'), $4::bigint, $5::asset_id, $6::trade_side, $7::int,
                 decode($8::text, 'hex'), to_timestamp($9::float8))
         on conflict (order_id) do nothing`,
        [
          decision,
          order.actionIndex,
          orderId.slice(2),
          order.botId.toString(),
          ASSET_IDS[order.asset],
          order.buy ? "BUY" : "SELL",
          order.bps,
          sig.slice(2),
          order.deadline.toString(),
        ],
      );
    }
  };
}

/**
 * The bot's Daily Call view (SPEC §6.4.1). It goes only into `daily_calls`, whose public view hides it until the
 * user's own call is on-chain. One view per bot and day: the first one signed stands.
 */
export async function prepareDailyView(
  deps: Pick<RunnerDeps, "runner" | "dailyCall">,
  botId: bigint,
  decidedAt: Date,
  view: DecisionOutput["daily_call"],
): Promise<(tx: Queryable) => Promise<void>> {
  if (!view) return async () => {};
  const signed = await signDailyCallView(deps.runner, deps.dailyCall, { botId, decidedAt, btcUp: view.btc_up });
  return async (tx) => {
    await tx.query(
      `insert into daily_calls (bot_id, day, bot_up, bot_up_sig)
       values ($1::bigint, $2::int, $3::boolean, decode($4::text, 'hex'))
       on conflict (bot_id, day) do nothing`,
      [botId.toString(), signed.day, signed.botUp, signed.botSig.slice(2)],
    );
  };
}
