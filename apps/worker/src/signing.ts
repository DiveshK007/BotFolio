import type { Address, Hex, LocalAccount } from "viem";
import { APPROVED_ORDER_TYPES, paperLedgerDomain, type ApprovedOrder } from "./interfaces";

/**
 * The runner's EIP-712 signature over a big move (SPEC §4.3, §6.4 step 9). It signs the whole struct,
 * so the owner can only approve exactly this orderId, size and deadline.
 * The account is passed in; the key only ever comes from Render env.
 */
export function signApprovedOrder(runner: LocalAccount, paperLedger: Address, order: ApprovedOrder): Promise<Hex> {
  return runner.signTypedData({
    domain: paperLedgerDomain(paperLedger),
    types: APPROVED_ORDER_TYPES,
    primaryType: "ApprovedOrder",
    message: order,
  });
}
