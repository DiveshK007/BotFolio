import { InternalFailure } from "../auth/log";
import { isQuantity, type RelayRpc } from "./rpc";

export interface Fees {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/**
 * Most we'll ever pay per gas. QIE was at 1.125 gwei on Nov 22 (1 gwei base + 0.125 tip). A broken or hostile RPC
 * quoting a huge price must not be able to drain the hot wallet.
 */
export const MAX_FEE_PER_GAS = 25_000_000_000n;
const CACHE_MS = 5_000;

export class FeeSource {
  private cached: { at: number; fees: Fees } | undefined;

  constructor(
    private readonly rpc: RelayRpc,
    private readonly now: () => number,
  ) {}

  async current(): Promise<Fees> {
    const now = this.now();
    if (this.cached && now - this.cached.at < CACHE_MS) return this.cached.fees;

    const price = BigInt(await this.rpc.read("eth_gasPrice", [], isQuantity));
    if (price > MAX_FEE_PER_GAS) throw new InternalFailure("gas_price_above_cap");
    const tip = await this.rpc
      .read("eth_maxPriorityFeePerGas", [], isQuantity)
      .then(BigInt, () => price / 10n); // not every node has the method

    const maxFeePerGas = min(price * 2n, MAX_FEE_PER_GAS);
    const fees = { maxFeePerGas, maxPriorityFeePerGas: min(tip, maxFeePerGas) };
    this.cached = { at: now, fees };
    return fees;
  }
}

/** Fees for replacing a tx that paid `last`, or null when that would go over the cap. */
export function bumpFees(last: Fees, current: Fees): Fees | null {
  // Nodes want at least +10 % on both fields to accept a replacement.
  const minimum = (v: bigint) => v + v / 8n + 1n;
  if (minimum(last.maxFeePerGas) > MAX_FEE_PER_GAS) return null;
  const bump = (was: bigint, is: bigint) => max(is, max(minimum(was), (was * 3n) / 2n));
  const maxFeePerGas = min(bump(last.maxFeePerGas, current.maxFeePerGas), MAX_FEE_PER_GAS);
  return { maxFeePerGas, maxPriorityFeePerGas: min(bump(last.maxPriorityFeePerGas, current.maxPriorityFeePerGas), maxFeePerGas) };
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);
