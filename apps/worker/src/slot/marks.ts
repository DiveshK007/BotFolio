import type { AssetId } from "@botfolio/shared";
import { publicJson } from "../decisions/json";
import { portfolioValueE8, positionValueE8 } from "../gate/ledger-math";
import type { Portfolio, Price } from "../gate/types";
import { ASSET_IDS } from "../interfaces";
import type { Queryable } from "../scheduler/db";
import type { Market } from "./market";

/**
 * SPEC §5 rule 6: marks use each asset's latest valid answer. A feed that can't be read right now keeps its last
 * stored one: a mark at 0 would show a crash that didn't happen.
 */
export async function markPrices(db: Queryable, market: Pick<Market, "prices">): Promise<Record<AssetId, Price>> {
  const prices = { ...market.prices };
  for (const asset of ASSET_IDS) {
    if (prices[asset].priceE8 > 0n) continue;
    const { rows } = await db.query<{ answer: string }>(
      "select answer::text as answer from oracle_reads where asset = $1::asset_id order by updated_at desc limit 1",
      [asset],
    );
    if (rows[0]) prices[asset] = { priceE8: BigInt(rows[0].answer), fresh: false };
  }
  return prices;
}

export async function saveMark(
  db: Queryable,
  slotId: string,
  botId: bigint,
  portfolio: Portfolio,
  prices: Readonly<Record<AssetId, Price>>,
): Promise<void> {
  const holdings: Partial<Record<AssetId, { units_e18: bigint; value_e8: bigint }>> = {};
  for (const asset of ASSET_IDS) {
    const units = portfolio.unitsE18[asset];
    if (units > 0n) holdings[asset] = { units_e18: units, value_e8: positionValueE8(portfolio, prices, asset) };
  }
  await db.query(
    `insert into portfolio_marks (bot_id, slot_id, cash_e8, holdings, value_e8)
     values ($1::bigint, $2::bigint, $3::numeric, $4::jsonb, $5::numeric)
     on conflict (bot_id, slot_id) do update set
       cash_e8 = excluded.cash_e8, holdings = excluded.holdings, value_e8 = excluded.value_e8`,
    [
      botId.toString(),
      slotId,
      portfolio.cashE8.toString(),
      JSON.stringify(publicJson(holdings)),
      portfolioValueE8(portfolio, prices).toString(),
    ],
  );
}
