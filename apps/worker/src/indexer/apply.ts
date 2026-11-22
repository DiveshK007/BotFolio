import type { Hex } from "viem";
import type { BotState, ChainSource } from "./chain";
import type { Queryable } from "./db";
import type { DecodedLogs, IndexedEvent, LogPosition } from "./decode";
import { handleEvent } from "./handlers";
import { skipped, type EventContext, type Outcome } from "./handlers/types";

export interface Problem extends LogPosition {
  event: string;
  kind: "skipped" | "waiting";
  reason: string;
}

export interface BatchResult {
  written: number;
  ignored: number;
  problems: Problem[];
}

/**
 * Writes one block range inside the caller's transaction. Each event has its own savepoint: one that Postgres
 * refuses is reported and the batch goes on. An RPC or connection error is not the event's fault, so it
 * propagates and the caller rolls back the whole range.
 */
export async function applyLogs(
  db: Queryable,
  decoded: DecodedLogs,
  source: ChainSource,
  stateBlock: bigint,
): Promise<BatchResult> {
  const result: BatchResult = {
    written: 0,
    ignored: 0,
    problems: decoded.unreadable.map(({ contract, topic, block, txHash, logIndex }) => ({
      block,
      txHash,
      logIndex,
      event: contract,
      kind: "skipped",
      reason: `unreadable log, topic0 ${topic}`,
    })),
  };

  const byTx = new Map<Hex, IndexedEvent[]>();
  for (const event of decoded.events) {
    const list = byTx.get(event.txHash);
    if (list) list.push(event);
    else byTx.set(event.txHash, [event]);
  }

  const chain = cacheReads(source);
  for (const event of decoded.events) {
    const { block, txHash, logIndex } = event;
    const ctx: EventContext = { db, chain, stateBlock, block, txHash, logIndex, txEvents: byTx.get(txHash)! };

    await db.query("savepoint indexer_event");
    let outcome: Outcome;
    try {
      outcome = await handleEvent(event, ctx);
    } catch (e) {
      const reason = eventFault(e);
      if (reason === null) throw e;
      outcome = skipped(reason);
    }
    if (outcome.kind !== "written") await db.query("rollback to savepoint indexer_event");
    await db.query("release savepoint indexer_event");

    if (outcome.kind === "written") result.written++;
    else if (outcome.kind === "ignored") result.ignored++;
    else {
      result.problems.push({
        block,
        txHash,
        logIndex,
        event: `${event.contract}.${event.name}`,
        kind: outcome.kind,
        reason: outcome.reason,
      });
    }
  }
  return result;
}

/**
 * A reason if the event's own values caused this error. null means infrastructure (RPC, connection, lock, missing
 * table): skipping for those would lose good events.
 */
function eventFault(e: unknown): string | null {
  if (!(e instanceof Error)) return null;
  const code = (e as Error & { code?: unknown }).code;
  // SQLSTATE classes: 21 cardinality, 22 bad value, 23 constraint, 54 size limit.
  if (typeof code === "string" && /^(21|22|23|54)[0-9A-Z]{3}$/.test(code)) return `database ${code}: ${e.message}`;
  if (e instanceof RangeError || e instanceof TypeError) return `${e.name}: ${e.message}`;
  return null;
}

/** One RPC read per block and per bot in a batch, however many events mention them. */
function cacheReads(source: ChainSource): EventContext["chain"] {
  const times = new Map<bigint, Promise<bigint>>();
  const bots = new Map<string, Promise<BotState>>();
  return {
    blockTime(block) {
      let time = times.get(block);
      if (!time) times.set(block, (time = source.blockTime(block)));
      return time;
    },
    botState(botId, atBlock) {
      const key = `${botId}@${atBlock}`;
      let state = bots.get(key);
      if (!state) bots.set(key, (state = source.botState(botId, atBlock)));
      return state;
    },
    scores: (season, atBlock) => source.scores(season, atBlock),
    txPosition: (hash) => source.txPosition(hash),
  };
}
