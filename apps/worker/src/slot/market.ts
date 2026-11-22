import type { AssetId } from "@botfolio/shared";
import type { PriceChange } from "../decision/input";
import type { Price } from "../gate/types";
import { ASSET_IDS } from "../interfaces";
import type { OracleReading } from "../oracle";
import type { Queryable } from "../scheduler/db";

export interface Market {
  readings: OracleReading[];
  /** As PaperLedger sees them: an unusable answer is 0. */
  prices: Record<AssetId, Price>;
  changes: Partial<Record<AssetId, PriceChange>>;
}

export function pricesFrom(readings: readonly OracleReading[]): Record<AssetId, Price> {
  return Object.fromEntries(
    ASSET_IDS.map((asset) => {
      const r = readings.find((reading) => reading.asset === asset);
      return [asset, { priceE8: r?.valid ? BigInt(r.priceE8) : 0n, fresh: r?.fresh ?? false }];
    }),
  ) as Record<AssetId, Price>;
}

const HOUR_MS = 3_600_000;
/** How much older than 24 h / 7 d the compared round may be: feeds can go hours without a new one. */
const TOLERANCE_24H = 12 * HOUR_MS;
const TOLERANCE_7D = 24 * HOUR_MS;

/** SPEC §6.2: changes come from our stored oracle rounds, never from a price API. */
export async function priceChanges(
  db: Queryable,
  prices: Readonly<Record<AssetId, Price>>,
  now: Date,
): Promise<Partial<Record<AssetId, PriceChange>>> {
  const before = async (agoMs: number, toleranceMs: number) => {
    const { rows } = await db.query<{ asset: AssetId; answer: string }>(
      `select distinct on (asset) asset::text as asset, answer::text as answer
       from oracle_reads
       where updated_at <= $1::timestamptz and updated_at >= $2::timestamptz
       order by asset, updated_at desc`,
      [new Date(now.getTime() - agoMs).toISOString(), new Date(now.getTime() - agoMs - toleranceMs).toISOString()],
    );
    return new Map(rows.map((row) => [row.asset, BigInt(row.answer)]));
  };
  const day = await before(24 * HOUR_MS, TOLERANCE_24H);
  const week = await before(7 * 24 * HOUR_MS, TOLERANCE_7D);

  const change = (price: bigint, then: bigint | undefined) =>
    then && price > 0n ? Number(((price - then) * 1_000_000n) / then) / 10_000 : null;
  return Object.fromEntries(
    ASSET_IDS.map((asset) => [
      asset,
      { chg24hPct: change(prices[asset].priceE8, day.get(asset)), chg7dPct: change(prices[asset].priceE8, week.get(asset)) },
    ]),
  );
}
