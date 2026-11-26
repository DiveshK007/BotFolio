import { priceDecimals, usd } from "./format";
import { readOracle } from "./oracle";
import type { TickerItem } from "@/components/site/arcade";

/**
 * LED ticker: live oracle prices read from QIE (30 s revalidate). On RPC failure the ticker says so; no stale or sample prices.
 * Only updatedAt goes into the HTML; the Ticker works out ages in the browser, so a cached page never shows an old age.
 */
export async function tickerItems(): Promise<{ items: TickerItem[] | null; status: "live" | "error" }> {
  try {
    const reads = await readOracle(undefined, 30);
    return { status: "live", items: reads.map(r => ({ asset: r.asset, price: usd(Number(BigInt(r.answerE8) / 10_000n) / 10_000, priceDecimals(r.asset)), roundId: r.roundId, updatedAt: r.updatedAt })) };
  } catch {
    return { status: "error", items: null };
  }
}
