import type { IndexedEvent } from "../decode";
import {
  bytes,
  decisionUuid,
  pgText,
  skipped,
  waiting,
  written,
  type ContractHandlers,
  type EventArgs,
} from "./types";

/**
 * UNVERIFIED: SPEC §2.2 names the chips but nothing gives their uint8 ids (ISeasonLedger: "defined off-chain").
 * This is the spec's order, then "blocked". It belongs in packages/shared, because the app signs the id.
 */
export const CHIPS = ["too risky", "too timid", "wrong coin", "sold too early", "blocked"] as const;

type Correction = EventArgs<"SeasonLedger", "CallCorrected">;

function sameCorrection(event: IndexedEvent, wanted: Correction): boolean {
  if (event.name !== "CallCorrected") return false;
  const args = event.args as Correction;
  return (
    args.botId === wanted.botId &&
    args.decisionId === wanted.decisionId &&
    args.noteHash === wanted.noteHash &&
    args.chip === wanted.chip
  );
}

export const seasonLedgerHandlers: ContractHandlers<"SeasonLedger"> = {
  async VersionCommitted({ botId, version, hash }, ctx) {
    const limits = ctx.txEvents
      .filter((event) => event.contract === "BotRegistry" && event.name === "BotLimitsChanged")
      .map((event) => event.args as EventArgs<"BotRegistry", "BotLimitsChanged">)
      .find((args) => args.botId === botId && args.version === version);
    if (!limits) return skipped("no BotLimitsChanged in the same tx");

    const id = botId.toString();
    const bot = await ctx.db.query("select id from bots where id = $1::bigint", [id]);
    if (bot.rows.length === 0) return waiting("no bots row");

    const approvedAt = (await ctx.chain.blockTime(ctx.block)).toString();
    // The owner can sign any hash. Proposed text is kept only under the hash it was proposed with, so a page
    // never shows rules next to a hash that doesn't cover them.
    await ctx.db.query(
      `insert into bot_versions
         (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source, committed_tx, approved_at)
       values ($1::bigint, $2::int, '', $3::int, $4::int,
               jsonb_build_object('max_per_coin_bps', $3::int, 'max_trades_per_day', $4::int),
               $5::bytea, 'season_v2', $6::text, to_timestamp($7::float8))
       on conflict (bot_id, version) do update set
         rules_text         = case when bot_versions.config_hash = $5::bytea then bot_versions.rules_text else '' end,
         config_json        = case when bot_versions.config_hash = $5::bytea then bot_versions.config_json
                                   else excluded.config_json end,
         max_per_coin_bps   = excluded.max_per_coin_bps,
         max_trades_per_day = excluded.max_trades_per_day,
         config_hash        = excluded.config_hash,
         source             = excluded.source,
         committed_tx       = excluded.committed_tx,
         approved_at        = excluded.approved_at`,
      [id, version, limits.maxPerCoinBps, limits.maxTradesPerDay, bytes(hash), ctx.txHash, approvedAt],
    );
    return written;
  },

  async CallCorrected(args, ctx) {
    const { botId, decisionId, noteHash } = args;
    const chip = CHIPS[args.chip];
    if (!chip) return skipped(`unknown chip ${args.chip}`);
    const decision = decisionUuid(decisionId);
    if (!decision) return skipped("decisionId is not a padded uuid");

    // The contract never looks at decisionId. Without both checks one user could break the FK, or put a
    // correction on somebody else's decision.
    const { rows } = await ctx.db.query<{ own: boolean; owner: string }>(
      `select d.bot_id = $2::bigint as own, b.owner_wallet as owner
       from decisions d join bots b on b.id = d.bot_id
       where d.id = $1::uuid`,
      [decision, botId.toString()],
    );
    const found = rows[0];
    if (!found) return skipped("unknown decisionId");
    if (!found.own) return skipped("the decision belongs to another bot");

    const createdAt = (await ctx.chain.blockTime(ctx.block)).toString();
    const key = [botId.toString(), decision, chip, bytes(noteHash)];

    // corrections has no log_index, so the nth identical event of a tx is the nth such row of that tx.
    const earlier = ctx.txEvents.filter((e) => e.logIndex < ctx.logIndex && sameCorrection(e, args)).length;
    let target = await ctx.db.query<{ id: string }>(
      `select id::text as id from corrections
       where bot_id = $1::bigint and decision_id = $2::uuid and chip = $3::text and note_hash = $4::bytea
         and tx_hash = $5::text
       order by corrections.id offset $6::int limit 1`,
      [...key, ctx.txHash, earlier],
    );
    if (target.rows.length === 0) {
      // The app's pending row holds the note text. It's this event's only if the signer and note hash agree.
      target = await ctx.db.query<{ id: string }>(
        `select id::text as id from corrections
         where bot_id = $1::bigint and decision_id = $2::uuid and chip = $3::text and note_hash = $4::bytea
           and tx_hash is null and user_wallet = $5::text
         order by corrections.id limit 1 for update`,
        [...key, found.owner],
      );
    }

    // recordCorrection requires _msgSender() == owner, so the owner is the signer. tx.from is our relayer.
    const row = target.rows[0];
    if (row) {
      await ctx.db.query(
        `update corrections set user_wallet = $2::text, tx_hash = $3::text, created_at = to_timestamp($4::float8)
         where id = $1::bigint`,
        [row.id, found.owner, ctx.txHash, createdAt],
      );
    } else {
      await ctx.db.query(
        `insert into corrections (bot_id, decision_id, chip, note_hash, user_wallet, tx_hash, created_at)
         values ($1::bigint, $2::uuid, $3::text, $4::bytea, $5::text, $6::text, to_timestamp($7::float8))`,
        [...key, found.owner, ctx.txHash, createdAt],
      );
    }
    // SPEC §2.2: Block is this correction. The runner must then not send the safe-size order for the decision.
    if (chip === "blocked") {
      await ctx.db.query("update big_moves set status = 'blocked' where decision_id = $1::uuid and status = 'pending'", [decision]);
    }
    return written;
  },

  // Seasons are seeded config (#134). kind and provisional_min_trades can't be known from the event.
  async SeasonOpened({ n, start, end }, ctx) {
    const { rows } = await ctx.db.query(
      `update seasons set starts_at = to_timestamp($2::float8), ends_at = to_timestamp($3::float8)
       where id = $1::int
       returning id`,
      [n, start.toString(), end.toString()],
    );
    return rows.length > 0 ? written : waiting("no seasons row (seed it)");
  },

  async SeasonClosed({ n, dataRoot, dataURI }, ctx) {
    const { rows } = await ctx.db.query(
      `update seasons set status = 'closed', data_root = $2::bytea, data_uri = $3::text, root_tx = $4::text
       where id = $1::int
       returning id`,
      [n, bytes(dataRoot), pgText(dataURI), ctx.txHash],
    );
    return rows.length > 0 ? written : waiting("no seasons row (seed it)");
  },
};
