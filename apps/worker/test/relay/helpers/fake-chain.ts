import { keccak256, parseTransaction, type Hex } from "viem";
import { fakeNode, type RpcAnswer } from "./http";

interface Tx {
  nonce: number;
  hash: Hex;
  raw: Hex;
  tip: bigint;
}

/** What happens to the next eth_sendRawTransaction, one entry per send. */
export type SendBehaviour = "ok" | "accept_then_drop" | "accept_then_nonce_used" | "drop" | { refuse: string };

/**
 * A node's mempool, for the nonce manager. `strict` is the Cosmos-EVM behaviour (QIE's client looks like one):
 * no nonce gaps, "invalid nonce; got N, expected M". Otherwise geth-like: gaps wait, replacement by fee.
 */
export async function fakeChain(options: { strict?: boolean; startNonce?: number; chainId?: number } = {}) {
  const start = options.startNonce ?? 0;
  const state = {
    mined: start,
    pool: new Map<number, Tx>(),
    receipts: new Map<Hex, { status: "0x0" | "0x1"; gasUsed: Hex }>(),
    /** Every send that reached the node, in order. */
    sent: [] as Tx[],
    behaviours: [] as SendBehaviour[],
    gasPrice: 1_125_000_000n,
    failing: new Set<string>(),
    /** Nonces that never mine unless replaced with a higher tip. */
    unminable: new Set<Hex>(),
  };

  const pending = () => {
    let next = state.mined;
    while (state.pool.has(next)) next++;
    return next;
  };

  function accept(tx: Tx): RpcAnswer {
    const held = state.pool.get(tx.nonce);
    if (held?.hash === tx.hash) return { error: { code: -32000, message: "already known" } };
    if (tx.nonce < state.mined) {
      return options.strict
        ? { error: { code: -32000, message: `invalid nonce; got ${tx.nonce}, expected ${pending()}: invalid sequence` } }
        : { error: { code: -32000, message: "nonce too low" } };
    }
    if (held && tx.tip <= held.tip + held.tip / 10n) {
      return { error: { code: -32000, message: "replacement transaction underpriced" } };
    }
    if (!held && options.strict && tx.nonce > pending()) {
      return { error: { code: -32000, message: `invalid nonce; got ${tx.nonce}, expected ${pending()}: invalid sequence` } };
    }
    state.pool.set(tx.nonce, tx);
    return { result: tx.hash };
  }

  const node = await fakeNode((method, params): RpcAnswer => {
    if (state.failing.has(method)) return "drop";
    switch (method) {
      case "eth_chainId":
        return { result: `0x${(options.chainId ?? 1990).toString(16)}` };
      case "eth_gasPrice":
        return { result: `0x${state.gasPrice.toString(16)}` };
      case "eth_maxPriorityFeePerGas":
        return { result: "0x7735940" };
      case "eth_getTransactionCount":
        return { result: `0x${(params[1] === "pending" ? pending() : state.mined).toString(16)}` };
      case "eth_getTransactionByHash":
        return { result: [...state.pool.values()].find((t) => t.hash === params[0]) ? { hash: params[0] } : null };
      case "eth_getTransactionReceipt":
        return { result: state.receipts.get(params[0]) ?? null };
      case "eth_sendRawTransaction": {
        const raw = params[0] as Hex;
        const parsed = parseTransaction(raw);
        const tx = { nonce: parsed.nonce ?? 0, hash: keccak256(raw), raw, tip: parsed.maxPriorityFeePerGas ?? 0n };
        state.sent.push(tx);
        const behaviour = state.behaviours.shift() ?? "ok";
        if (behaviour === "drop") return "drop";
        if (behaviour === "accept_then_drop") {
          accept(tx);
          return "drop";
        }
        if (behaviour === "accept_then_nonce_used") {
          accept(tx); // a load balancer retried our POST on a second backend
          return { error: { code: -32000, message: "nonce too low" } };
        }
        if (behaviour !== "ok") return { error: { code: -32000, message: behaviour.refuse } };
        return accept(tx);
      }
    }
    return { error: { code: -32601, message: "method not found" } };
  });

  function mine(status: "0x0" | "0x1" = "0x1"): void {
    for (;;) {
      const tx = state.pool.get(state.mined);
      if (!tx || state.unminable.has(tx.hash)) return;
      state.pool.delete(state.mined);
      state.receipts.set(tx.hash, { status, gasUsed: "0x1e240" });
      state.mined++;
    }
  }

  /** The mempool forgets everything, as after a node restart. */
  const forget = () => state.pool.clear();

  return { ...node, state, mine, forget, pending };
}
