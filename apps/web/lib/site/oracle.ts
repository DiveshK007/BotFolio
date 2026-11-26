/**
 * Server-side reads straight from QIE mainnet over JSON-RPC (no worker needed): oracle prices and tx lookups.
 * RPC list from QIE_RPC_URLS (SPEC §0.1) with failover, because rpc1/rpc2 sometimes drop TLS.
 */
import { ASSETS, type AssetId } from "@botfolio/shared";

const RPCS = (process.env.QIE_RPC_URLS ?? "https://rpc3mainnet.qie.digital,https://rpc4mainnet.qie.digital,https://rpc5mainnet.qie.digital,https://rpc1mainnet.qie.digital,https://rpc2mainnet.qie.digital").split(",").map(s => s.trim()).filter(Boolean);

export async function rpc<T>(method: string, params: unknown[], revalidate = 0): Promise<T> {
  let last: unknown = null;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(6000),
        ...(revalidate ? { next: { revalidate } } : { cache: "no-store" }),
      } as RequestInit);
      const j = (await r.json()) as { result?: T; error?: unknown };
      if (j.error) { last = j.error; continue; }
      return j.result as T;
    } catch (e) { last = e; }
  }
  throw new Error(`QIE RPC failed: ${String(last)}`);
}

export interface OracleRead { asset: AssetId; roundId: string; answerE8: string; updatedAt: number /* unix s */ }
/** latestRoundData() on each feed: (roundId, answer, startedAt, updatedAt, answeredInRound). */
export async function readOracle(assets: readonly AssetId[] = ASSETS.map(a => a.id as AssetId), revalidate = 30): Promise<OracleRead[]> {
  return Promise.all(assets.map(async id => {
    const feed = ASSETS.find(a => a.id === id)!.feed;
    const hex = (await rpc<string>("eth_call", [{ to: feed, data: "0xfeaf968c" }, "latest"], revalidate)).slice(2);
    const word = (i: number) => BigInt("0x" + hex.slice(i * 64, i * 64 + 64));
    return { asset: id, roundId: word(0).toString(), answerE8: word(1).toString(), updatedAt: Number(word(3)) };
  }));
}
