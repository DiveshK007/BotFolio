import { validateJson } from "@botfolio/llm";
import { DECISION_OUTPUT_SCHEMA, type DecisionOutput } from "../decision/schema";
import { ASSET_IDS, ASSET_INDEX, orderIdOf } from "../interfaces";
import { isBigMove, toBigMove } from "./big-move";
import { checkTrade, type CheckResult } from "./check";
import { filterOutput } from "./filter-output";
import { applyTrade, type Trade } from "./ledger-math";
import type { BigMove, DropReason, GateEvent, GateInput, GateOrder, GateResult } from "./types";

/** A BUY or SELL with its position in the decision's actions array. */
export interface Proposal extends Trade {
  actionIndex: number;
}

/**
 * The deterministic risk gate (SPEC §6.4). Pure: no clock, no I/O, no randomness.
 *
 * Actions are checked one after another against a simulated portfolio, because that is how
 * `executeBatch` runs them: the second BUY spends a share of the cash the first one left.
 * `actionIndex` stays the position in the original array, HOLDs included (SPEC §3).
 *
 * Big moves (step 9) are not in the batch, so they don't change that simulated portfolio. The owner
 * approves one after the batch has run, so each is checked again against the portfolio the batch
 * leaves behind. Example: BUY Gold 40 % (big) then BUY Gold 20 % (batch) needs the big one clipped
 * to the room left next to the 20 %, or `executeApproved` would revert on the per-coin cap.
 *
 * Step 1's "one retry" happens in the LLM client; by the time output gets here it is final.
 */
export function gate(input: GateInput, output: unknown, rulesVersion: string): GateResult {
  // Step 1.
  const schemaErrors = validateJson(DECISION_OUTPUT_SCHEMA, output);
  if (schemaErrors.length > 0) {
    return {
      rulesVersion,
      status: "invalid",
      orders: [],
      bigMoves: [],
      events: [],
      proposedActions: 0,
      output: null,
      textFlags: [],
      // An unknown key is the model's own text and gate_result is public, so don't echo it.
      errors: schemaErrors.map((e) =>
        e.message === "is not allowed" ? "an unknown key is not allowed" : `${e.path} ${e.message}`,
      ),
    };
  }

  const decision = output as DecisionOutput;
  const proposals: Proposal[] = decision.actions.flatMap(({ asset, action, pct }, actionIndex) =>
    action === "HOLD" ? [] : [{ asset, buy: action === "BUY", bps: pct * 100, actionIndex }],
  );

  const events: GateEvent[] = [];
  const orders: GateOrder[] = [];
  let portfolio = input.portfolio;
  let tradesLeft = input.bot.maxTradesPerDay - input.bot.tradesToday;
  const needApproval: Proposal[] = [];

  for (const proposal of proposals) {
    const result = checkTrade(input, portfolio, proposal, tradesLeft);
    events.push(...eventsFor(proposal, result));
    if (!result.ok) continue;

    // An approved big move also counts toward tradesToday (SPEC §4.3), so it uses up a trade here.
    tradesLeft--;
    // Step 9.
    if (!input.bot.isHouse && isBigMove(input, portfolio, result.trade)) {
      needApproval.push({ ...result.trade, actionIndex: proposal.actionIndex });
      continue;
    }
    portfolio = applyTrade(portfolio, input.prices, result.trade);
    orders.push(toOrder(input, result.trade, proposal.actionIndex));
  }

  const bigMoves: BigMove[] = [];
  for (const proposal of needApproval) {
    // Its trade was reserved above, hence 1 left.
    const result = checkTrade(input, portfolio, proposal, 1);
    events.push(...eventsFor(proposal, result));
    if (result.ok) bigMoves.push(toBigMove(input, portfolio, result.trade, proposal.actionIndex));
  }

  // Step 8. Runs last only because the neutral reason names what ended up traded; it never changes an order.
  const traded = [...orders, ...bigMoves.map((m) => m.order)].map((o) => ASSET_IDS[o.asset]!);
  const filtered = filterOutput(decision, traded);
  // gate_result is public (site_decisions) and the bot's view is secret until the user picks (§6.4.1).
  const { daily_call: _secretView, ...publicOutput } = filtered.output;

  return {
    rulesVersion,
    status: statusOf(proposals.length, orders.length, events),
    orders,
    bigMoves,
    events,
    proposedActions: proposals.length,
    output: publicOutput,
    textFlags: filtered.textFlags,
    errors: [],
  };
}

const NOT_THE_BOTS_FAULT: ReadonlySet<DropReason> = new Set(["stale", "inactive"]);

/** Step 7. A trade can be both clipped and then dropped (clipped below the 1 % minimum). */
export function eventsFor(proposal: Proposal, result: CheckResult): GateEvent[] {
  const base = {
    actionIndex: proposal.actionIndex,
    asset: proposal.asset,
    action: proposal.buy ? ("BUY" as const) : ("SELL" as const),
  };
  const events: GateEvent[] = [];
  if (result.clippedTo !== undefined) {
    events.push({ ...base, kind: "clip", reason: "coin_cap", fromBps: proposal.bps, toBps: result.clippedTo, countsForF1: true });
  }
  if (!result.ok) {
    events.push({ ...base, kind: "drop", reason: result.reason, countsForF1: !NOT_THE_BOTS_FAULT.has(result.reason) });
  }
  return events;
}

export function toOrder(input: Pick<GateInput, "bot" | "decisionId">, trade: Trade, actionIndex: number): GateOrder {
  return {
    botId: input.bot.botId,
    asset: ASSET_INDEX[trade.asset],
    buy: trade.buy,
    bps: trade.bps,
    decisionId: input.decisionId,
    actionIndex,
    orderId: orderIdOf(input.decisionId, actionIndex),
  };
}

/**
 * Describes this slot's batch. `skipped_stale` only when stale prices are the sole reason nothing trades
 * (SPEC §5 rule 4). A decision with nothing but a pending big move is `held` until its trade executes.
 */
function statusOf(proposed: number, accepted: number, events: GateEvent[]): GateResult["status"] {
  if (accepted > 0) return "executed";
  const staleDrops = events.filter((e) => e.kind === "drop" && e.reason === "stale").length;
  return proposed > 0 && staleDrops === proposed ? "skipped_stale" : "held";
}
