import type { Hex } from "viem";

export type RpcReply =
  | { kind: "result"; result: unknown }
  /** The node answered with a JSON-RPC error. */
  | { kind: "error"; code: number | undefined; message: string; data: Hex | undefined }
  /** No usable answer: timeout, dropped connection, garbage. For a send this means "maybe". */
  | { kind: "no_answer" };

/** The EVM ran the call and it failed, so asking another node won't change the answer. */
export class ExecutionFailed extends Error {
  override name = "ExecutionFailed";
  constructor(readonly data: Hex | undefined) {
    super("execution failed");
  }
}

export class RpcUnavailable extends Error {
  override name = "RpcUnavailable";
}

// Seen live on rpc3/4/5 on Nov 22: "execution reverted" (code 3 with data, -32000 without),
// "rpc error: code = Internal desc = out of gas" and "... intrinsic gas too low".
const EXECUTION_FAILURE =
  /execution reverted|out of gas|intrinsic gas too low|gas required exceeds allowance|invalid opcode|invalid jump destination|stack (?:under|over)flow/i;

const NODE_TIMEOUT_MS = 3_000;
const TOTAL_TIMEOUT_MS = 8_000;
const COOLDOWN_MS = 30_000;

/**
 * JSON-RPC with failover. This isn't viem's fallback transport because the relayer must tell three things
 * apart that fallback blurs: "the EVM rejected it", "the node failed" and "we don't know if it got there".
 * A node that didn't answer goes to the back of the line for 30 s, so a dead RPC doesn't slow every relay.
 */
export class RelayRpc {
  private readonly coolingUntil = new Map<string, number>();

  constructor(
    private readonly urls: readonly string[],
    private readonly timeouts = { nodeMs: NODE_TIMEOUT_MS, totalMs: TOTAL_TIMEOUT_MS },
  ) {}

  nodes(): string[] {
    const now = Date.now();
    const cooling = (url: string) => (this.coolingUntil.get(url) ?? 0) > now;
    return [...this.urls.filter((u) => !cooling(u)), ...this.urls.filter(cooling)];
  }

  async ask(url: string, method: string, params: readonly unknown[], timeoutMs = this.timeouts.nodeMs): Promise<RpcReply> {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = (await res.json()) as { result?: unknown; error?: { code?: unknown; message?: unknown; data?: unknown } };
      if (json?.error && typeof json.error.message === "string") {
        this.coolingUntil.delete(url);
        const { code, message, data } = json.error;
        return {
          kind: "error",
          code: typeof code === "number" ? code : undefined,
          message: message as string,
          data: typeof data === "string" && /^0x([0-9a-fA-F]{2})*$/.test(data) ? (data as Hex) : undefined,
        };
      }
      if (res.ok && json && "result" in json) {
        this.coolingUntil.delete(url);
        return { kind: "result", result: json.result };
      }
    } catch {
      // Deliberately dropped: fetch errors carry the RPC URL.
    }
    this.coolingUntil.set(url, Date.now() + COOLDOWN_MS);
    return { kind: "no_answer" };
  }

  /** A read. `isValid` rejects malformed results, so a broken node can't turn into a yes. */
  async read<T>(method: string, params: readonly unknown[], isValid: (v: unknown) => v is T): Promise<T> {
    const until = Date.now() + this.timeouts.totalMs;
    for (const url of this.nodes()) {
      const left = until - Date.now();
      if (left <= 0) break;
      const reply = await this.ask(url, method, params, Math.min(left, this.timeouts.nodeMs));
      if (reply.kind === "result" && isValid(reply.result)) return reply.result;
      if (reply.kind === "error" && (reply.code === 3 || EXECUTION_FAILURE.test(reply.message))) {
        throw new ExecutionFailed(reply.data);
      }
    }
    throw new RpcUnavailable("no QIE RPC answered");
  }
}

export const isQuantity = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(v);
export const isBytes = (v: unknown): v is Hex => typeof v === "string" && /^0x([0-9a-fA-F]{2})*$/.test(v);
