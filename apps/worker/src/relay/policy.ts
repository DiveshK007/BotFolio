import {
  RELAY_LIMITS,
  findAllowlisted,
  type ForwardRequest,
  type RelayAllowlisted,
  type RelayTargetAddresses,
} from "@botfolio/shared";
import { RelayRefusal } from "./errors";

/**
 * The deadline is checked against block.timestamp, and a tx takes a block or two to land (~3.6 s each).
 * Closer than this, we'd pay for a revert.
 */
export const MIN_SECONDS_LEFT = 10;

/**
 * SPEC §11: only the 8 (target, selector) pairs, value 0, gas ≤ 300k, deadline ≤ 10 min.
 * docs/gas.md (#24) kept 300k: the worst relayed call, executeApproved over 5 feeds, needs 173,400.
 */
export function checkPolicy(
  request: ForwardRequest,
  targets: RelayTargetAddresses,
  nowSeconds: number,
): RelayAllowlisted {
  const entry = findAllowlisted(targets, request.to, request.data);
  if (!entry) throw new RelayRefusal("NOT_ALLOWLISTED");
  if (request.value !== RELAY_LIMITS.value) throw new RelayRefusal("VALUE_NOT_ZERO");
  if (request.gas > RELAY_LIMITS.maxGas) throw new RelayRefusal("GAS_TOO_HIGH");
  if (request.deadline < nowSeconds + MIN_SECONDS_LEFT) throw new RelayRefusal("DEADLINE_EXPIRED");
  if (request.deadline > nowSeconds + RELAY_LIMITS.maxDeadlineSeconds) throw new RelayRefusal("DEADLINE_TOO_FAR");
  return entry;
}
