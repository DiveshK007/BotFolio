import { randomUUID } from "node:crypto";
import { decisionIdFromUuid } from "@botfolio/shared";
import { hashJson } from "../canonical";
import { runDecisionCall, wantsDailyCall } from "../decision/call";
import { buildDecisionInput } from "../decision/input";
import { houseRecord, llmDecision, saveDecision, type DecisionRecord } from "../decisions/record";
import { publicJson } from "../decisions/json";
import type { GateInput } from "../gate/types";
import { houseDecision, type HouseContext } from "../house/strategies";
import type { Slot } from "../scheduler/slots";
import { averageEntries, botProfile, houseStrategy, recentCorrections } from "./bots";
import type { LedgerState } from "./chain";
import { GATE_RULES_VERSION, type RunnerDeps } from "./deps";
import type { Market } from "./market";
import { prepareBigMoves, prepareDailyView } from "./signed";

export function gateInputFor(
  deps: Pick<RunnerDeps, "bigMove">,
  decisionUuid: string,
  botId: bigint,
  state: LedgerState,
  market: Pick<Market, "prices">,
  now: Date,
): GateInput {
  const { bot, portfolio, tradesToday } = state;
  return {
    decisionId: decisionIdFromUuid(decisionUuid),
    bot: {
      botId,
      active: bot.active,
      isHouse: bot.house,
      maxPerCoinBps: bot.maxPerCoinBps,
      maxTradesPerDay: bot.maxTradesPerDay,
      tradesToday,
    },
    portfolio,
    prices: market.prices,
    nowSeconds: Math.floor(now.getTime() / 1000),
    bigMove: deps.bigMove,
  };
}

/**
 * One bot, one slot: decide, gate, and write the decision with its big moves and Daily Call view in one
 * transaction. Nothing is sent from here (src/slot/deliver.ts does), so a crash can't trade without a logged
 * decision. Returns null for a bot that isn't active on-chain.
 */
export async function decideBot(
  deps: RunnerDeps,
  slot: Slot,
  botId: bigint,
  market: Market,
): Promise<DecisionRecord | null> {
  const { db, chain, health } = deps;
  const now = deps.now();
  // A fresh random id per bot and slot: the orderId has no botId in it, so two bots must never share one.
  const id = randomUUID();

  const state = await chain.state(botId, Math.floor(now.getTime() / 1000));
  if (!state.bot.active) return null;
  const profile = await botProfile(db, botId, state.bot);
  const made = {
    id,
    version: profile.version,
    slot,
    gateInput: gateInputFor(deps, id, botId, state, market, now),
    readings: market.readings,
    rulesVersion: GATE_RULES_VERSION,
  };

  let record: DecisionRecord;
  let writeView: Awaited<ReturnType<typeof prepareDailyView>> = async () => {};

  if (state.bot.house) {
    const context: HouseContext = {
      strategy: houseStrategy(profile.name),
      slot,
      seasonStart: slot.season?.startsAt ?? null,
      portfolio: state.portfolio,
      prices: market.prices,
      chg24hPct: Object.fromEntries(Object.entries(market.changes).map(([asset, c]) => [asset, c?.chg24hPct])),
    };
    const input = publicJson({
      ...context,
      slot: { kind: slot.kind, time: slot.time.toISOString() },
      seasonStart: context.seasonStart?.toISOString() ?? null,
    });
    record = houseRecord(made, houseDecision(context), input);
  } else {
    const input = buildDecisionInput({
      slotTime: slot.time,
      bot: {
        name: profile.name,
        persona: profile.persona,
        rules: profile.rules,
        maxPerCoinBps: state.bot.maxPerCoinBps,
        maxTradesPerDay: state.bot.maxTradesPerDay,
        tradesToday: state.tradesToday,
        version: profile.version,
      },
      portfolio: state.portfolio,
      startValueE8: await chain.startCashE8(),
      avgEntryE8: await averageEntries(db, botId),
      prices: market.prices,
      changes: market.changes,
      recentCorrections: await recentCorrections(db, botId),
    });
    const call = await runDecisionCall({
      llm: deps.llm,
      config: deps.llmConfig,
      input,
      slot,
      budget: health.budget(now),
      logLine: (line) => deps.log.info("llm.decision", JSON.parse(line) as object),
    });
    if (call.log.usage) health.recordLlmUsage(call.log.model, call.log.usage, now);

    record = llmDecision(made, call);
    if (record.result.status !== "invalid" && wantsDailyCall(slot)) {
      writeView = await prepareDailyView(deps, botId, slot.time, call.output?.daily_call);
    }
  }

  const writeMoves = await prepareBigMoves(deps, id, record.result.bigMoves);
  const saved = await db.transaction(async (tx) => {
    if (!(await saveDecision(tx, record, now))) return false;
    await writeMoves(tx);
    await writeView(tx);
    return true;
  });
  if (!saved) return null; // another run got there first, and its decision stands
  deps.log.info("runner.decided", {
    decision: id,
    botId,
    status: record.result.status,
    orders: record.result.orders.length,
    bigMoves: record.result.bigMoves.length,
    inputHash: hashJson(record.input),
  });
  return record;
}
