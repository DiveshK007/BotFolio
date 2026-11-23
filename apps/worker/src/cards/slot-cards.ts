import type { RoastCardPayload, TradeCardPayload } from "@botfolio/shared";
import type { Queryable } from "../scheduler/db";
import type { Log } from "../scheduler/log";
import {
  TRADE_COLUMNS,
  cardBot,
  cardTrust,
  cardValue,
  changeBps,
  markOf,
  saveCard,
  seasonAt,
  tradeCitation,
  tradePrice,
  type CardChain,
  type TradeRow,
} from "./build";

/** SPEC §9: a roast card for a loss of 3 % or more in one slot. */
export const ROAST_LOSS_BPS = 300;
/** How far back the sweep looks, so a first deploy doesn't card the whole history. */
export const SWEEP_LOOKBACK_MS = 48 * 3_600_000;
/** Recent trades a roast cites: the positions that lost. */
const ROAST_CITES = 3;

export interface CardDeps {
  db: Queryable;
  chain: CardChain;
  log: Log;
  now(): Date;
}

/**
 * The cards that follow trades and marks (#185): a bot's first trade, and a slot loss of 3 % or more. Run it
 * often; each card has a fixed id, so it is written once.
 */
export async function sweepSlotCards(deps: CardDeps): Promise<number> {
  return (await firstTradeCards(deps)) + (await slotLossCards(deps));
}

async function firstTradeCards({ db, chain, log, now }: CardDeps): Promise<number> {
  const { rows } = await db.query<TradeRow & { bot_id: string; slot_id: string }>(
    `select distinct on (t.bot_id) t.bot_id::text as bot_id, d.slot_id::text as slot_id, ${TRADE_COLUMNS}
     from trades t join decisions d on d.id = t.decision_id
     where t.tx_hash is not null
       and not exists (select 1 from cards c where c.id = 'trade-' || t.bot_id::text)
     order by t.bot_id, t.block_number, t.log_index`,
  );
  let made = 0;
  for (const t of rows) {
    const bot = await cardBot(db, t.bot_id);
    // The mark after the trade: its own slot's (written once the slot is done).
    const mark = await markOf(db, t.bot_id, t.slot_id);
    if (!bot || !mark || !t.reason) continue;
    const startCash = await chain.startCashE8();
    const card: TradeCardPayload = {
      schemaVersion: 1,
      kind: "trade",
      cardId: `trade-${t.bot_id}`,
      createdAt: now().toISOString(),
      bot,
      seasonId: await seasonAt(db, mark.slotTime),
      value: await cardValue(db, chain, mark),
      change: { bps: changeBps(startCash, mark.valueE8), deltaE8: (mark.valueE8 - startCash).toString(), since: "start" },
      trust: await cardTrust(db, t.bot_id),
      line: { source: "reason", decisionId: t.decision_id, text: t.reason },
      cites: [tradeCitation(t)],
      trade: {
        decisionId: t.decision_id,
        actionIndex: t.action_index,
        side: t.side,
        cashE8: t.cash_e8,
        unitsE18: t.units_e18,
        price: await tradePrice(db, chain, t),
        approvedByOwner: t.approved,
        txHash: t.tx_hash,
      },
    };
    if (await saveCard(db, card)) made++;
  }
  if (made > 0) log.info("cards.trade", { made });
  return made;
}

async function slotLossCards({ db, chain, log, now }: CardDeps): Promise<number> {
  const since = new Date(now().getTime() - SWEEP_LOOKBACK_MS).toISOString();
  const { rows } = await db.query<{ bot_id: string; slot_id: string; before: string; after: string; slot_time: Date }>(
    `select * from (
       select m.bot_id::text as bot_id, m.slot_id::text as slot_id, s.slot_time, m.value_e8::text as after,
              lag(m.value_e8) over (partition by m.bot_id order by s.slot_time, s.id)::text as before
       from portfolio_marks m join slots s on s.id = m.slot_id
       join bots b on b.id = m.bot_id and not b.is_house
     ) x
     where x.slot_time >= $1::timestamptz and x.before is not null
       and (x.before::numeric - x.after::numeric) * 10000 >= x.before::numeric * $2::int
       and not exists (select 1 from cards c where c.id = 'roast-' || x.bot_id || '-' || x.slot_id)`,
    [since, ROAST_LOSS_BPS],
  );

  let made = 0;
  for (const r of rows) {
    const before = BigInt(r.before);
    const mark = await markOf(db, r.bot_id, r.slot_id);
    const bot = await cardBot(db, r.bot_id);
    if (!mark || !bot) continue;

    // The slot's decision says something in the bot's voice: its roast, else its reason (default until #219 says).
    const { rows: decisions } = await db.query<{ id: string; roast: string | null; reason: string | null }>(
      "select id::text as id, roast, reason from decisions where bot_id = $1::bigint and slot_id = $2::bigint",
      [r.bot_id, r.slot_id],
    );
    const d = decisions[0];
    const text = d?.roast?.trim() ? d.roast : d?.reason?.trim() ? d.reason : null;
    if (!d || !text) continue;

    // What lost: the bot's latest trades up to this slot.
    const { rows: trades } = await db.query<TradeRow>(
      `select ${TRADE_COLUMNS} from trades t join decisions d on d.id = t.decision_id join slots s on s.id = d.slot_id
       where t.bot_id = $1::bigint and t.tx_hash is not null and s.slot_time <= $2::timestamptz
       order by t.block_number desc, t.log_index desc limit ${ROAST_CITES}`,
      [r.bot_id, mark.slotTime.toISOString()],
    );
    if (trades.length === 0) continue; // all cash can't lose; nothing to cite

    const loss = before - mark.valueE8;
    const lossBps = Number((loss * 10_000n) / before);
    const card: RoastCardPayload = {
      schemaVersion: 1,
      kind: "roast",
      cardId: `roast-${r.bot_id}-${r.slot_id}`,
      createdAt: now().toISOString(),
      bot,
      seasonId: await seasonAt(db, mark.slotTime),
      value: await cardValue(db, chain, mark),
      change: { bps: -lossBps, deltaE8: (-loss).toString(), since: "slot" },
      trust: await cardTrust(db, r.bot_id),
      line: { source: d.roast?.trim() ? "roast" : "reason", decisionId: d.id, text },
      cites: trades.map(tradeCitation),
      roast: { trigger: "slot_loss", slotTime: mark.slotTime.toISOString(), lossBps, lossE8: loss.toString() },
    };
    if (await saveCard(db, card)) made++;
  }
  if (made > 0) log.info("cards.roast", { made });
  return made;
}
