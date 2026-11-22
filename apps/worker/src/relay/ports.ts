import type { ForwardRequest } from "@botfolio/shared";
import type { Address, Hex } from "viem";
import type { PreparedCall } from "./chain";

/** A relay by a wallet that proved it is request.from. */
export interface RelayAttempt {
  wallet: Address;
  target: Address;
  selector: Hex | null;
  ip: string;
}

/** `cancelled` = a no-op replaced the tx. It is never a user action and never `confirmed`. */
export type RelayOutcome = "confirmed" | "reverted" | "cancelled";

export interface Reservation {
  /** relay_log.id */
  id: string;
  /** Stores the hash. Runs before the broadcast, so if it throws nothing is sent. */
  recordSigned(txHash: Hex): Promise<void>;
  recordOutcome(outcome: RelayOutcome, gasUsed: bigint | null, txHash: Hex): Promise<void>;
  /** Refused after reserving: gives the slot back. */
  release(): Promise<void>;
}

export interface RelayGuard {
  /** Checks and reserves in one atomic step. Throws RelayRefusal when over a limit. */
  reserve(attempt: RelayAttempt): Promise<Reservation>;
  /** Logs a refusal that never got a reservation. */
  recordRefusal(attempt: RelayAttempt): Promise<void>;
}

export interface RelayChain {
  prepare(request: ForwardRequest): Promise<PreparedCall>;
}

export interface SendJob extends PreparedCall {
  deadline: number;
  reservation: Reservation;
}

export interface RelaySender {
  /**
   * Resolves once the tx was, or may have been, broadcast. Throws ONLY when it certainly wasn't:
   * the caller then releases the reservation and tells the user nothing was sent.
   */
  send(job: SendJob): Promise<{ txHash: Hex }>;
}
