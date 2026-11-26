import { encodeFunctionData, concat, hexToBytes, numberToHex, type Address, type Hex } from "viem";
import type { ForwardRequest } from "@botfolio/shared";
import { InternalFailure } from "../auth/log";
import { FORWARDER_ABI } from "./abis";
import { RelayRefusal } from "./errors";
import { wouldRevert } from "./revert";
import { ExecutionFailed, RpcUnavailable, isBytes, isQuantity, type RelayRpc } from "./rpc";

/** What the relayer would broadcast: `forwarder.execute(request)` and the gas limit for it. */
export interface PreparedCall {
  to: Address;
  data: Hex;
  gas: bigint;
}

/** Room for execute's own work: signature check, nonce write, trust check, event, copying calldata. */
const EXECUTE_OVERHEAD_GAS = 120_000n;
const ESTIMATE_MARGIN_GAS = 15_000n;

const isWord = (v: unknown): v is Hex => isBytes(v) && v.length === 66;

/**
 * The pre-checks from SPEC §11, all read-only, all before any gas is spent:
 *  1. forwarder.verify: signature, forwarder nonce, deadline, and that the target trusts this forwarder.
 *  2. eth_call of the inner request exactly as the forwarder makes it, so we learn the revert reason
 *     (execute itself only says FailedInnerCall).
 *  3. eth_estimateGas of execute from the relayer: the whole tx must succeed, and it sizes the gas limit.
 */
export class ForwarderChain {
  constructor(
    private readonly rpc: RelayRpc,
    private readonly forwarder: Address,
    private readonly relayer: Address,
  ) {}

  async prepare(request: ForwardRequest): Promise<PreparedCall> {
    try {
      await this.verify(request);
      await this.simulateInner(request);
      return await this.sizeExecute(request);
    } catch (error) {
      if (error instanceof RpcUnavailable) throw new RelayRefusal("RPC_UNAVAILABLE");
      throw error;
    }
  }

  private async verify(request: ForwardRequest): Promise<void> {
    const data = encodeFunctionData({ abi: FORWARDER_ABI, functionName: "verify", args: [request] });
    let word: Hex;
    try {
      word = await this.rpc.read("eth_call", [{ to: this.forwarder, data }, "latest"], isWord);
    } catch (error) {
      if (error instanceof ExecutionFailed) throw new RelayRefusal("INVALID_SIGNATURE");
      throw error;
    }
    // Exactly true. Any other word is a refusal.
    if (BigInt(word) !== 1n) {
      throw new RelayRefusal("INVALID_SIGNATURE");
    }
  }

  /**
   * ERC-2771: the target must see msg.sender = forwarder and the signer's 20 bytes appended to the calldata.
   * eth_call's `gas` includes the intrinsic cost, so that is added back for the target to get exactly request.gas.
   */
  private async simulateInner(request: ForwardRequest): Promise<void> {
    const data = concat([request.data, request.from]);
    const call = { from: this.forwarder, to: request.to, data, gas: numberToHex(request.gas + intrinsicGas(data)) };
    try {
      await this.rpc.read("eth_call", [call, "latest"], isBytes);
    } catch (error) {
      if (error instanceof ExecutionFailed) throw wouldRevert(error.data);
      throw error;
    }
  }

  /**
   * QIE bills at least half of the gas limit (seen Nov 22: used = limit / 2 in 19 sampled txs), so the limit
   * follows the estimate instead of always allowing for the full request.gas. The forwarder still enforces that
   * the inner call can't be starved: estimates below that point fail, so the estimate already covers it.
   */
  private async sizeExecute(request: ForwardRequest): Promise<PreparedCall> {
    const data = encodeFunctionData({ abi: FORWARDER_ABI, functionName: "execute", args: [request] });
    let estimate: bigint;
    try {
      const call = { from: this.relayer, to: this.forwarder, data };
      estimate = BigInt(await this.rpc.read("eth_estimateGas", [call], isQuantity));
    } catch (error) {
      if (error instanceof ExecutionFailed) throw wouldRevert(error.data);
      throw error;
    }
    const ceiling = intrinsicGas(data) + (request.gas * 64n) / 63n + EXECUTE_OVERHEAD_GAS;
    if (estimate > ceiling) throw new InternalFailure("gas_estimate_above_ceiling");
    // #339: an estimate of bare intrinsic gas is a broken node, not a cheap call. The user signed for request.gas.
    if (isBogusEstimate(estimate, intrinsicGas(data))) return { to: this.forwarder, data, gas: ceiling };
    const padded = estimate + estimate / 4n + ESTIMATE_MARGIN_GAS;
    return { to: this.forwarder, data, gas: padded < ceiling ? padded : ceiling };
  }
}

/** Bare intrinsic gas (+ slack) means the node never ran the code (#339). A few real no-ops (an already-used order) also land here; they then just get the floor or ceiling. */
export const isBogusEstimate = (estimate: bigint, intrinsic: bigint) => estimate < intrinsic + 10_000n;

/** Shanghai intrinsic gas: 21000 + 4 per zero byte + 16 per non-zero byte. */
export function intrinsicGas(data: Hex): bigint {
  let gas = 21_000n;
  for (const byte of hexToBytes(data)) gas += byte === 0 ? 4n : 16n;
  return gas;
}
