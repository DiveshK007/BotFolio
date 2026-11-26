import type { ForwardRequest, RelayAllowlisted } from "@botfolio/shared";
import type { Address, Hex } from "viem";
import type { Identity } from "../auth/types";
import type { PreparedCall } from "./chain";

/** A relay by a wallet that proved it is request.from. */
export interface RelayAttempt {
  wallet: Address;
  target: Address;
  selector: Hex | null;
  /** null until the request passed the allowlist. */
  action: RelayAllowlisted | null;
  ip: string;
  /**
   * Every wallet of the signed-in user (a Privy user can have several). The 30/day limit counts them together
   * (#219). Defaults to `[wallet]`.
   */
  userWallets?: readonly Address[];
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
  /** The user has a `users` row, which is only written with `terms_accepted_at` (18+ and Terms, SPEC §11). */
  hasAcceptedTerms(identity: Pick<Identity, "wallets" | "privyDid">): Promise<boolean>;
  /** The Daily Call pick POST /daily-call/view stored for this bot and IST day, or null if none (#219). */
  dailyCallPick(botId: bigint, day: number): Promise<boolean | null>;
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
