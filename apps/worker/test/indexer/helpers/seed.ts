import { hexToBytes, padHex, toHex, type Hex } from "viem";
import { orderIdOf, decisionIdFromUuid } from "@botfolio/shared";
import type { Queryable } from "../../../src/indexer/db";

// What other parts of BotFolio write before the events arrive: seeds, the runner, the relayer.
// Times are fixed, so two databases seeded the same way compare equal.

const AT = "2026-11-24T03:30:00Z";
export const hash = (n: number): Hex => padHex(toHex(n), { size: 32 });

export async function seedSeason(db: Queryable, id: number): Promise<void> {
  await db.query(
    `insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades)
     values ($1::int, $2::timestamptz, $2::timestamptz + interval '2 days', 'sprint', 8)`,
    [id, AT],
  );
}

/**
 * A decision needs its bot and version. Tests that seed before indexing use this stand-in row, which is what an
 * optimistic row looks like: no created_tx.
 */
export async function seedBot(
  db: Queryable,
  bot: { id: bigint; owner: string; personaHash: Hex; name?: string },
): Promise<void> {
  await db.query(
    `insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash, created_at)
     values ($1::bigint, $2::text, $3::text, 'G', 'Loves gold.', $4::bytea, $5::timestamptz)
     on conflict (id) do nothing`,
    [bot.id.toString(), bot.owner.toLowerCase(), bot.name ?? "GoldGuru", hexToBytes(bot.personaHash), AT],
  );
  await db.query(
    `insert into bot_versions
       (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source)
     values ($1::bigint, 1, 'Buy gold on dips.', 4000, 4, '{"style":"careful"}'::jsonb, $2::bytea, 'create')
     on conflict (bot_id, version) do nothing`,
    [bot.id.toString(), hexToBytes(bot.personaHash)],
  );
}

let slots = 0;

export async function seedDecision(db: Queryable, id: string, botId: bigint): Promise<void> {
  slots = (slots % 10_000) + 1;
  const slot = await db.query<{ id: string }>(
    "insert into slots (slot_time, kind) values ($1::timestamptz, 'debut') returning id::text as id",
    [AT],
  );
  await db.query(
    `insert into decisions (id, bot_id, version, slot_id, prompt_version, model, input_json, input_hash, status, created_at)
     values ($1::uuid, $2::bigint, 1, $3::bigint, 'prompt-v1', 'fake', '{}'::jsonb, $4::bytea, 'executed', $5::timestamptz)`,
    [id, botId.toString(), slot.rows[0]!.id, hexToBytes(hash(slots)), AT],
  );
}

export async function seedBigMove(
  db: Queryable,
  move: { decision: string; actionIndex: number; botId: bigint },
): Promise<void> {
  await db.query(
    `insert into big_moves (decision_id, action_index, order_id, bot_id, asset, side, bps, runner_sig, deadline, created_at)
     values ($1::uuid, $2::int, $3::bytea, $4::bigint, 'GOLD', 'BUY', 3500, '\\x01'::bytea, $5::timestamptz, $5::timestamptz)`,
    [
      move.decision,
      move.actionIndex,
      hexToBytes(orderIdOf(decisionIdFromUuid(move.decision), move.actionIndex)),
      move.botId.toString(),
      AT,
    ],
  );
}

export async function seedBotView(
  db: Queryable,
  view: { botId: bigint; day: number; botUp: boolean; sig?: Hex },
): Promise<void> {
  await db.query(
    `insert into daily_calls (bot_id, day, bot_up, bot_up_sig)
     values ($1::bigint, $2::int, $3::boolean, $4::bytea)`,
    [view.botId.toString(), view.day, view.botUp, hexToBytes(view.sig ?? "0x5161")],
  );
}

export async function seedRelay(
  db: Queryable,
  relay: { wallet: string; txHash: Hex; status?: string },
): Promise<void> {
  await db.query(
    `insert into relay_log (user_wallet, status, tx_hash, created_at)
     values ($1::text, $2::relay_status, $3::text, $4::timestamptz)`,
    [relay.wallet.toLowerCase(), relay.status ?? "submitted", relay.txHash.toLowerCase(), AT],
  );
}

export async function seedPendingCorrection(
  db: Queryable,
  c: { botId: bigint; decision: string; wallet: string; chip: string; note: string; noteHash: Hex },
): Promise<void> {
  await db.query(
    `insert into corrections (bot_id, decision_id, user_wallet, chip, note, note_hash, created_at)
     values ($1::bigint, $2::uuid, $3::text, $4::text, $5::text, $6::bytea, $7::timestamptz)`,
    [c.botId.toString(), c.decision, c.wallet.toLowerCase(), c.chip, c.note, hexToBytes(c.noteHash), AT],
  );
}
