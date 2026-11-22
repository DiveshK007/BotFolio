import { waiting, written, type ContractHandlers } from "./types";

export const dailyCallHandlers: ContractHandlers<"DailyCall"> = {
  async Called({ botId, day, userUp, botUp, price, roundId }, ctx) {
    // DailyCall.call requires _msgSender() == owner, so the caller is the bot's owner, never the relayer.
    // Normally the runner's row (with its signature) exists. If not, the contract already checked the signature,
    // so the user's call is still written, with an empty bot_up_sig.
    const { rows } = await ctx.db.query(
      `insert into daily_calls
         (bot_id, day, user_wallet, user_up, bot_up, bot_up_sig, price_at_call_e8, round_at_call, call_tx)
       select id, $2::int, owner_wallet, $3::boolean, $4::boolean, ''::bytea, $5::numeric, $6::numeric, $7::text
       from bots where id = $1::bigint
       on conflict (bot_id, day) do update set
         user_wallet      = excluded.user_wallet,
         user_up          = excluded.user_up,
         bot_up           = excluded.bot_up,
         price_at_call_e8 = excluded.price_at_call_e8,
         round_at_call    = excluded.round_at_call,
         call_tx          = excluded.call_tx
       returning id`,
      [botId.toString(), day, userUp, botUp, price.toString(), roundId.toString(), ctx.txHash],
    );
    return rows.length > 0 ? written : waiting("no bots row");
  },

  async Settled({ botId, day, price, roundId, userCorrect, botCorrect }, ctx) {
    // An equal price is "no winner": false/false on-chain, null/null in the schema.
    const { rows } = await ctx.db.query(
      `update daily_calls set
         settle_price_e8 = $3::numeric,
         settle_round    = $4::numeric,
         user_correct    = case when price_at_call_e8 = $3::numeric then null else $5::boolean end,
         bot_correct     = case when price_at_call_e8 = $3::numeric then null else $6::boolean end,
         settle_tx       = $7::text
       where bot_id = $1::bigint and day = $2::int and call_tx is not null
       returning id`,
      [botId.toString(), day, price.toString(), roundId.toString(), userCorrect, botCorrect, ctx.txHash],
    );
    return rows.length > 0 ? written : waiting("no indexed call to settle");
  },
};
