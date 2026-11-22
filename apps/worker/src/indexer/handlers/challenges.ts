import { waiting, written, type ContractHandlers } from "./types";

// Status only moves forward (open → accepted → settled, open → expired), so a replayed older event can't undo it.
export const challengeHandlers: ContractHandlers<"Challenges"> = {
  async ChallengeCreated({ code, myBot, season }, ctx) {
    // `create` takes the next season too, which may not be seeded yet.
    const { rows } = await ctx.db.query(
      `insert into challenges (code, season_id, challenger_bot, create_tx)
       select $1::text, s.id, b.id, $4::text
       from seasons s, bots b
       where s.id = $2::int and b.id = $3::bigint
       on conflict (code) do update set
         season_id      = excluded.season_id,
         challenger_bot = excluded.challenger_bot,
         create_tx      = excluded.create_tx
       returning code`,
      [code.toLowerCase(), season, myBot.toString(), ctx.txHash],
    );
    return rows.length > 0 ? written : waiting("no seasons or bots row");
  },

  async ChallengeAccepted({ code, theirBot }, ctx) {
    const { rows } = await ctx.db.query(
      `update challenges c set
         opponent_bot = b.id,
         accept_tx    = $3::text,
         status       = case when c.status = 'open' then 'accepted' else c.status end
       from bots b
       where c.code = $1::text and b.id = $2::bigint
       returning c.code`,
      [code.toLowerCase(), theirBot.toString(), ctx.txHash],
    );
    return rows.length > 0 ? written : waiting("no challenges or bots row");
  },

  async ChallengeSettled({ code, winnerBot }, ctx) {
    const { rows } = await ctx.db.query(
      `update challenges c set status = 'settled', winner_bot = b.id
       from bots b
       where c.code = $1::text and b.id = $2::bigint
       returning c.code`,
      [code.toLowerCase(), winnerBot.toString()],
    );
    return rows.length > 0 ? written : waiting("no challenges or bots row");
  },

  async ChallengeExpired({ code }, ctx) {
    const { rows } = await ctx.db.query(
      "update challenges set status = 'expired' where code = $1::text returning code",
      [code.toLowerCase()],
    );
    return rows.length > 0 ? written : waiting("no challenges row");
  },
};
