import { ASSETS, orderIdOf } from "@botfolio/shared";
import { bytes, decisionUuid, ignored, skipped, waiting, written, type ContractHandlers } from "./types";

const ASSET_BY_INDEX = new Map(ASSETS.map((asset) => [asset.index, asset.id]));

export const paperLedgerHandlers: ContractHandlers<"PaperLedger"> = {
  async Trade({ botId, asset, buy, cashE8, unitsE18, priceE8, roundId, decisionId, actionIndex }, ctx) {
    const assetId = ASSET_BY_INDEX.get(asset);
    if (!assetId) return skipped(`unknown asset index ${asset}`);
    const decision = decisionUuid(decisionId);
    if (!decision) return skipped("decisionId is not a padded uuid");

    const { rows } = await ctx.db.query<{ own: boolean }>(
      "select bot_id = $2::bigint as own from decisions where id = $1::uuid",
      [decision, botId.toString()],
    );
    const found = rows[0];
    if (!found) return waiting("no decisions row");
    if (!found.own) return skipped("the decision belongs to another bot");

    await ctx.db.query(
      `insert into trades
         (decision_id, action_index, order_id, bot_id, asset, side,
          cash_e8, units_e18, price_e8, round_id, tx_hash, log_index, block_number)
       values ($1::uuid, $2::int, $3::bytea, $4::bigint, $5::asset_id, $6::trade_side,
               $7::numeric, $8::numeric, $9::numeric, $10::numeric, $11::text, $12::int, $13::bigint)
       on conflict (order_id) do update set
         decision_id  = excluded.decision_id,
         action_index = excluded.action_index,
         bot_id       = excluded.bot_id,
         asset        = excluded.asset,
         side         = excluded.side,
         cash_e8      = excluded.cash_e8,
         units_e18    = excluded.units_e18,
         price_e8     = excluded.price_e8,
         round_id     = excluded.round_id,
         tx_hash      = excluded.tx_hash,
         log_index    = excluded.log_index,
         block_number = excluded.block_number`,
      [
        decision,
        actionIndex,
        bytes(orderIdOf(decisionId, actionIndex)),
        botId.toString(),
        assetId,
        buy ? "BUY" : "SELL",
        cashE8.toString(),
        unitsE18.toString(),
        priceE8.toString(),
        roundId.toString(),
        ctx.txHash,
        ctx.logIndex,
        ctx.block.toString(),
      ],
    );
    return written;
  },

  // big_moves.user_tx is also how site_activity_stats tells the owner's trade from the runner's.
  async ApprovedTrade({ botId, decisionId, actionIndex }, ctx) {
    const { rows } = await ctx.db.query(
      `update big_moves set status = 'approved', user_tx = $3::text
       where order_id = $1::bytea and bot_id = $2::bigint
       returning id`,
      [bytes(orderIdOf(decisionId, actionIndex)), botId.toString(), ctx.txHash],
    );
    return rows.length > 0 ? written : waiting("no big_moves row");
  },

  async OrderSkipped() {
    return ignored("no table for skipped orders");
  },
};
