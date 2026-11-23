import { istDay, type CardCallRef, type CardCitation, type RecapCardPayload } from "@botfolio/shared";
import { leaderboards, type Leaderboards } from "../season/leaderboards";
import {
  TRADE_COLUMNS,
  callRef,
  cardBot,
  cardTrust,
  cardValue,
  changeBps,
  markOf,
  saveCard,
  seasonAt,
  slotPrices,
  tradeCitation,
  type TradeRow,
} from "./build";
import type { CardDeps } from "./slot-cards";

/** Cites on a recap: today's trades, best call first. */
const MAX_CITES = 10;

/**
 * The daily recap (SPEC §2.2, §9; cron 21:35 IST): one card per active raised bot, quiet days too. Today's value
 * change, best and worst call, and rank in the season. Its id is `recap-<botId>-<IST day>`, so it is made once.
 */
export async function makeRecaps(deps: CardDeps, signal: AbortSignal): Promise<number> {
  const { db, chain, log } = deps;
  const now = deps.now();
  const day = istDay(Math.floor(now.getTime() / 1000));
  const dayStart = new Date((day * 86_400 - 19_800) * 1000);

  const { rows: bots } = await db.query<{ bot_id: string; slot_id: string }>(
    `select distinct on (m.bot_id) m.bot_id::text as bot_id, m.slot_id::text as slot_id
     from portfolio_marks m join slots s on s.id = m.slot_id join bots b on b.id = m.bot_id
     where b.status = 'active' and not b.is_house
       and s.slot_time >= $1::timestamptz and s.slot_time <= $2::timestamptz
       and not exists (select 1 from cards c where c.id = 'recap-' || m.bot_id::text || '-' || $3::text)
     order by m.bot_id, s.slot_time desc, s.id desc`,
    [dayStart.toISOString(), now.toISOString(), String(day)],
  );

  const boards = new Map<number, Promise<Leaderboards | null>>();
  let made = 0;
  for (const { bot_id: botId, slot_id: slotId } of bots) {
    if (signal.aborted) break;
    const bot = await cardBot(db, botId);
    const mark = await markOf(db, botId, slotId);
    if (!bot || !mark) continue;
    const startCash = await chain.startCashE8();

    const { rows: before } = await db.query<{ value_e8: string }>(
      `select m.value_e8::text as value_e8 from portfolio_marks m join slots s on s.id = m.slot_id
       where m.bot_id = $1::bigint and s.slot_time < $2::timestamptz order by s.slot_time desc, s.id desc limit 1`,
      [botId, dayStart.toISOString()],
    );
    const from = before[0] ? BigInt(before[0].value_e8) : startCash;

    const { rows: trades } = await db.query<TradeRow>(
      `select ${TRADE_COLUMNS} from trades t join decisions d on d.id = t.decision_id join slots s on s.id = d.slot_id
       where t.bot_id = $1::bigint and t.tx_hash is not null and s.slot_time >= $2::timestamptz and s.slot_time <= $3::timestamptz
       order by t.block_number, t.log_index`,
      [botId, dayStart.toISOString(), now.toISOString()],
    );
    const prices = await slotPrices(db, slotId);
    const calls: { ref: CardCallRef; trade: TradeRow }[] = [];
    for (const t of trades) {
      const ref = await callRef(db, chain, t, prices);
      if (ref) calls.push({ ref, trade: t });
    }
    calls.sort((a, b) => b.ref.pnlBps - a.ref.pnlBps);
    const best = calls[0] ?? null;
    const worst = calls.length > 1 ? calls.at(-1)! : null;

    const seasonOfMark = await seasonAt(db, mark.slotTime);
    let rank: RecapCardPayload["recap"]["rank"] = null;
    if (seasonOfMark !== null) {
      if (!boards.has(seasonOfMark)) boards.set(seasonOfMark, leaderboards(db, seasonOfMark, chain.startCashE8));
      const board = (await boards.get(seasonOfMark)!)?.topReturns ?? [];
      const entry = board.find((e) => e.botId === botId);
      if (entry?.rank) rank = { position: entry.rank, of: board.filter((e) => !e.isHouse).length };
    }

    const { rows: said } = await db.query<{ id: string; reason: string }>(
      `select d.id::text as id, d.reason from decisions d join slots s on s.id = d.slot_id
       where d.bot_id = $1::bigint and s.slot_time >= $2::timestamptz and s.slot_time <= $3::timestamptz
         and coalesce(trim(d.reason), '') <> ''
       order by s.slot_time desc limit 1`,
      [botId, dayStart.toISOString(), now.toISOString()],
    );

    const cites: CardCitation[] = [];
    const seen = new Set<string>();
    for (const t of [...(best ? [best.trade] : []), ...trades]) {
      if (seen.has(t.tx_hash) || cites.length >= MAX_CITES) continue;
      seen.add(t.tx_hash);
      cites.push(tradeCitation(t));
    }
    // A cited call's tx must be among the cites; drop a worst call that didn't make the cap.
    const shown = (c: { ref: CardCallRef; trade: TradeRow } | null) => (c && seen.has(c.trade.tx_hash) ? c.ref : null);

    const card: RecapCardPayload = {
      schemaVersion: 1,
      kind: "recap",
      cardId: `recap-${botId}-${day}`,
      createdAt: now.toISOString(),
      bot,
      seasonId: await seasonAt(db, now),
      value: await cardValue(db, chain, mark),
      change: { bps: changeBps(from, mark.valueE8), deltaE8: (mark.valueE8 - from).toString(), since: "day" },
      trust: await cardTrust(db, botId),
      line: said[0] ? { source: "reason", decisionId: said[0].id, text: said[0].reason } : null,
      cites,
      recap: { day, best: shown(best), worst: shown(worst), rank },
    };
    if (await saveCard(db, card)) made++;
  }
  log.info("cards.recap", { day, made });
  return made;
}
