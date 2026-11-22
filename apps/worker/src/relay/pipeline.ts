import type { IncomingHttpHeaders } from "node:http";
import type { RelayResponse, RelayTargetAddresses } from "@botfolio/shared";
import type { Address } from "viem";
import { errorLabel, type Log } from "../auth/log";
import type { Authenticator } from "../auth/types";
import { RelayRefusal } from "./errors";
import { checkPolicy } from "./policy";
import type { RelayAttempt, RelayChain, RelayGuard, RelaySender, Reservation } from "./ports";
import { parseRelayBody, selectorOf } from "./request";

export interface RelayDeps {
  auth: Authenticator;
  guard: RelayGuard;
  chain: RelayChain;
  sender: RelaySender;
  /** Our own hot wallet. It can never be the user of a relay, or its txs would be counted as user activity. */
  relayer: Address;
  targets: RelayTargetAddresses;
  /** Unix seconds. */
  now?: () => number;
  log: Log;
}

export interface RelayInput {
  body: unknown;
  headers: IncomingHttpHeaders;
  ip: string;
}

/**
 * The checks run in the order of RELAY_ERROR_CODES (packages/shared/src/relay.ts), cheap ones first.
 * Every failure, expected or not, is answered before broadcast and gives any reservation back.
 */
export function createRelay(deps: RelayDeps) {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  return async function relay({ body, headers, ip }: RelayInput): Promise<{ status: number; body: RelayResponse }> {
    let attempt: RelayAttempt | undefined;
    let reservation: Reservation | undefined;
    try {
      const request = parseRelayBody(body);

      const identity = await deps.auth.authenticate(headers);
      if (!identity) throw new RelayRefusal("UNAUTHORIZED");
      if (!identity.wallets.includes(request.from) || request.from === deps.relayer.toLowerCase()) {
        throw new RelayRefusal("SIGNER_MISMATCH");
      }
      // From here on the wallet is proven, so it may be written to relay_log.
      attempt = { wallet: request.from, target: request.to, selector: selectorOf(request.data), action: null, ip };
      attempt.action = checkPolicy(request, deps.targets, now());

      reservation = await deps.guard.reserve(attempt);
      const call = await deps.chain.prepare(request);
      const { txHash } = await deps.sender.send({ ...call, deadline: request.deadline, reservation });

      deps.log("relay.submitted", { relayId: reservation.id, selector: attempt.selector, txHash });
      return { status: 200, body: { ok: true, status: "submitted", txHash, relayId: reservation.id } };
    } catch (error) {
      const refusal = error instanceof RelayRefusal ? error : new RelayRefusal("INTERNAL");
      deps.log("relay.refused", {
        code: refusal.code,
        relayId: reservation?.id,
        selector: attempt?.selector,
        ...(refusal !== error && { cause: errorLabel(error) }),
      });
      try {
        if (reservation) await reservation.release();
        else if (attempt) await deps.guard.recordRefusal(attempt);
      } catch (logError) {
        // The refusal stands. An unreleased reservation keeps counting, which is the safe direction.
        deps.log("relay.log_failed", { cause: errorLabel(logError) });
      }
      return { status: refusal.httpStatus, body: refusal.toBody() };
    }
  };
}

export type Relay = ReturnType<typeof createRelay>;
