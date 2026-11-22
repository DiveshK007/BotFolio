import { hexToBytes, type ContractEventName, type DecodeEventLogReturnType, type Hex } from "viem";
import { uuidFromDecisionId } from "@botfolio/shared";
import type { CONTRACT_EVENTS, ContractName } from "../abi";
import type { ChainSource } from "../chain";
import type { Queryable } from "../db";
import type { IndexedEvent, LogPosition } from "../decode";

export interface EventContext extends LogPosition {
  db: Queryable;
  chain: Pick<ChainSource, "blockTime" | "botState" | "scores" | "txPosition">;
  /**
   * The block to read contract state at: at or after the whole range being written. Mutable columns follow state
   * here rather than the event, so replaying an old range can't bring an old value back.
   */
  stateBlock: bigint;
  /** Every event of ours in the same tx, in log order. */
  txEvents: IndexedEvent[];
}

/**
 * `skipped`: the event can never be written as it is. `waiting`: a row someone else writes (decision, seeded
 * season) isn't there, and a replay after it appears will write this event. `ignored`: nothing to write.
 */
export type Outcome = { kind: "written" } | { kind: "ignored" | "skipped" | "waiting"; reason: string };

export const written: Outcome = { kind: "written" };
export const ignored = (reason: string): Outcome => ({ kind: "ignored", reason });
export const skipped = (reason: string): Outcome => ({ kind: "skipped", reason });
export const waiting = (reason: string): Outcome => ({ kind: "waiting", reason });

export type EventName<C extends ContractName> = ContractEventName<(typeof CONTRACT_EVENTS)[C]>;
export type EventArgs<C extends ContractName, E extends EventName<C>> = DecodeEventLogReturnType<
  (typeof CONTRACT_EVENTS)[C],
  E,
  Hex[],
  Hex,
  true
>["args"];

/** One handler per event. Leaving one out is a type error. */
export type ContractHandlers<C extends ContractName> = {
  [E in EventName<C>]: (args: EventArgs<C, E>, ctx: EventContext) => Promise<Outcome>;
};

// bytea parameters. The SQL casts them with ::bytea, because the bytes32 domain hides the type from some drivers.
export const bytes = (hex: Hex): Uint8Array => hexToBytes(hex);

/** null when it isn't a padded uuid. CallCorrected carries whatever the user signed. */
export function decisionUuid(decisionId: Hex): string | null {
  try {
    return uuidFromDecisionId(decisionId);
  } catch {
    return null;
  }
}

/** Postgres text can't hold NUL, and event strings can. */
export const pgText = (value: string): string => value.replaceAll("\u0000", "�");
