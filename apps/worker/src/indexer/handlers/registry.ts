import type { BotState } from "../chain";
import { bytes, ignored, skipped, waiting, written, type ContractHandlers } from "./types";

// An admin ban also clears `active`. `banned` is the only thing that tells it from the owner's pause.
const statusOf = (state: BotState) => (state.active ? "active" : state.banned ? "banned" : "paused");

export const registryHandlers: ContractHandlers<"BotRegistry"> = {
  async BotCreated({ botId, owner, personaHash, maxPerCoinBps, maxTradesPerDay }, ctx) {
    const id = botId.toString();
    const wallet = owner.toLowerCase();
    const { rows } = await ctx.db.query<{ same: boolean }>(
      `select (owner_wallet = $2::text and persona_hash = $3::bytea) as same from bots where id = $1::bigint for update`,
      [id, wallet, bytes(personaHash)],
    );
    // The chain hands out the id, so an optimistic row under it can be somebody else's bot. Keep its name and
    // text only if the owner and the persona hash are the ones in the event.
    const keepText = rows[0]?.same ?? false;

    const state = await ctx.chain.botState(botId, ctx.stateBlock);
    const createdAt = (await ctx.chain.blockTime(ctx.block)).toString();

    await ctx.db.query(
      `insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash, created_at, created_tx, is_house, status)
       values ($1::bigint, $2::text, $3::text, '', '', $4::bytea, to_timestamp($5::float8), $6::text, $7::boolean, $8::bot_status)
       on conflict (id) do update set
         owner_wallet = excluded.owner_wallet,
         name         = case when $9::boolean then bots.name else excluded.name end,
         emoji        = case when $9::boolean then bots.emoji else '' end,
         persona_text = case when $9::boolean then bots.persona_text else '' end,
         persona_hash = excluded.persona_hash,
         created_at   = excluded.created_at,
         created_tx   = excluded.created_tx,
         is_house     = excluded.is_house,
         status       = excluded.status`,
      [id, wallet, `Bot #${id}`, bytes(personaHash), createdAt, ctx.txHash, state.house, statusOf(state), keepText],
    );

    // ISeasonLedger.configHash: version 1's config is committed as the persona hash.
    await ctx.db.query(
      `insert into bot_versions
         (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source, committed_tx)
       values ($1::bigint, 1, '', $2::int, $3::int,
               jsonb_build_object('max_per_coin_bps', $2::int, 'max_trades_per_day', $3::int),
               $4::bytea, 'create', $5::text)
       on conflict (bot_id, version) do update set
         rules_text         = case when $6::boolean then bot_versions.rules_text else '' end,
         config_json        = case when $6::boolean then bot_versions.config_json else excluded.config_json end,
         max_per_coin_bps   = excluded.max_per_coin_bps,
         max_trades_per_day = excluded.max_trades_per_day,
         config_hash        = excluded.config_hash,
         source             = excluded.source,
         committed_tx       = excluded.committed_tx`,
      [id, maxPerCoinBps, maxTradesPerDay, bytes(personaHash), ctx.txHash, keepText],
    );
    return written;
  },

  // The limits are written with VersionCommitted, which has the hash and is emitted just before this one.
  async BotLimitsChanged({ botId, version }, ctx) {
    const paired = ctx.txEvents.some((event) => {
      if (event.name !== "VersionCommitted") return false;
      const args = event.args as { botId: bigint; version: number };
      return args.botId === botId && args.version === version;
    });
    return paired ? ignored("written with VersionCommitted") : skipped("no VersionCommitted in the same tx");
  },

  async BotActiveChanged({ botId }, ctx) {
    const state = await ctx.chain.botState(botId, ctx.stateBlock);
    const { rows } = await ctx.db.query(
      "update bots set status = $2::bot_status where id = $1::bigint returning id",
      [botId.toString(), statusOf(state)],
    );
    return rows.length > 0 ? written : waiting("no bots row");
  },
};
