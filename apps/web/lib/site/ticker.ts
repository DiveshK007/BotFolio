import { MAX_AGE_MIN, priceDecimals, usd } from "./format";
import { readOracle } from "./oracle";
import type { TickerItem } from "@/components/site/arcade";

/** LED ticker: live oracle prices read from QIE (30 s revalidate). On RPC failure the ticker says so; no stale or sample prices. */
export async function tickerItems(): Promise<{ items: TickerItem[] | null; status: "live" | "error" }> {
  try {
    const reads = await readOracle(undefined, 30);
    const now = Date.now() / 1000;
    return { status: "live", items: reads.map(r => ({ asset: r.asset, price: usd(Number(BigInt(r.answerE8) / 10_000n) / 10_000, priceDecimals(r.asset)), roundId: r.roundId, ageMin: (now - r.updatedAt) / 60, maxAgeMin: MAX_AGE_MIN[r.asset] })) };
  } catch {
    return { status: "error", items: null };
  }
}
