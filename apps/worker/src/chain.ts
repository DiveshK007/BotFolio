import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { qieMainnet } from "@botfolio/shared";
import type { WorkerConfig } from "./config";

/**
 * viem public client for QIE mainnet with failover across all configured RPCs (CLAUDE.md hard rule).
 * `fallback` tries the transports in order and moves on when one errors or times out; `rank: false`
 * keeps our fixed order (rpc3 first) instead of letting viem re-rank by latency.
 */
export function createQiePublicClient(cfg: Pick<WorkerConfig, "rpcUrls" | "chainId">): PublicClient {
  const chain = {
    ...qieMainnet,
    id: cfg.chainId,
    rpcUrls: { default: { http: cfg.rpcUrls } },
  };
  const transport = fallback(
    cfg.rpcUrls.map((url) => http(url, { timeout: 10_000, retryCount: 1, retryDelay: 250 })),
    { rank: false, retryCount: 0 },
  );
  return createPublicClient({ chain, transport }) as PublicClient;
}
