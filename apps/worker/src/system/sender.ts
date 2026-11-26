import { QIE_CHAIN_ID, qieMainnet } from "@botfolio/shared";
import { createWalletClient, fallback, http, type Abi, type Address, type LocalAccount, type TransactionReceipt } from "viem";
import { InternalFailure } from "../auth/log";
import { createQiePublicClient } from "../chain";
import { MAX_FEE_PER_GAS } from "../relay/fees";

export interface ContractWrite {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  /** Lowest gas limit to send, whatever the estimate says (#337). */
  minGas?: bigint;
}

export interface SystemSender {
  /** Resolves with a successful receipt. A throw can also mean "sent, outcome unknown": re-read the chain. */
  write(call: ContractWrite): Promise<TransactionReceipt>;
}

const RECEIPT_TIMEOUT_MS = 90_000;
const GAS_MARGIN = 15_000n;

/** Estimate + 25 % + margin, never below `minGas`. */
export const gasLimit = (estimate: bigint, minGas = 0n) => {
  const padded = estimate + estimate / 4n + GAS_MARGIN;
  return padded > minGas ? padded : minGas;
};

/**
 * A runner or committer wallet: the system txs, which are never user activity (SPEC §11).
 *
 * - One tx at a time per wallet, so two jobs can't take the same nonce.
 * - The gas limit follows the estimate, because QIE bills at least half the limit (docs/gas.md).
 * - The same fee cap as the relayer, so a broken RPC can't drain the wallet.
 * - No automatic resend: callers are idempotent by contract state and try again on their next run.
 */
export function createSystemSender(opts: { rpcUrls: readonly string[]; account: LocalAccount }): SystemSender {
  const rpcUrls = [...opts.rpcUrls];
  const { account } = opts;
  const reader = createQiePublicClient({ chainId: QIE_CHAIN_ID, rpcUrls });
  const wallet = createWalletClient({
    account,
    chain: qieMainnet,
    transport: fallback(
      rpcUrls.map((url) => http(url, { timeout: 10_000, retryCount: 0 })),
      { rank: false, retryCount: 0 },
    ),
  });

  let queue: Promise<unknown> = Promise.resolve();
  let chainChecked = false;

  async function send({ minGas, ...call }: ContractWrite): Promise<TransactionReceipt> {
    if (!chainChecked) {
      if ((await reader.getChainId()) !== QIE_CHAIN_ID) throw new InternalFailure("wrong_chain");
      chainChecked = true;
    }
    // The estimate is also the pre-check: a call that would revert throws here, before any gas is spent.
    const estimate = await reader.estimateContractGas({ ...call, account });
    const fees = await reader.estimateFeesPerGas();
    if (fees.maxFeePerGas > MAX_FEE_PER_GAS) throw new InternalFailure("gas_price_above_cap");

    const hash = await wallet.writeContract({
      ...call,
      account,
      chain: qieMainnet,
      gas: gasLimit(estimate, minGas),
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    const receipt = await reader.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    if (receipt.status !== "success") throw new InternalFailure("system_tx_reverted");
    return receipt;
  }

  return {
    write(call) {
      const result = queue.then(() => send(call));
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
