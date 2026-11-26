import {
  istDay,
  type BattleCardPayload,
  type CallCardPayload,
  type CardBattleEntry,
  type CardBot,
  type CardCitation,
  type CardOraclePrice,
  type CardVersionChange,
  type ChallengeCardPayload,
  type EvolutionCardPayload,
  type SeasonCardPayload,
} from "@botfolio/shared";
import type { Hex } from "viem";
import type { Queryable } from "../scheduler/db";
import type { V2Config } from "../v2/propose";
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
  type Mark,
  type TradeRow,
} from "./build";
import type { CardDeps } from "./slot-cards";

/** Closed seasons, commits and settlements older than this aren't carded on a first deploy. */
export const CLOSE_LOOKBACK_MS = 7 * 86_400_000;

/**
 * The cards that follow a season close, an approved v2, a settled challenge and a settled Daily Call (#185):
 * battle, season, evolution, challenge, call. Each id comes from its subject, so each is written once.
 */
export async function sweepCloseCards(deps: CardDeps): Promise<number> {
  return (await seasonCards(deps)) + (await evolutionCards(deps)) + (await challengeCards(deps)) + (await callCards(deps));
}

async function lastMarkIn(db: Queryable, botId: string, season: number): Promise<Mark | null> {
  const { rows } = await db.query<{ slot_id: string }>(
    `select m.slot_id::text as slot_id from portfolio_marks m join slots s on s.id = m.slot_id
     where m.bot_id = $1::bigint and s.season_id = $2::int order by s.slot_time desc, s.id desc limit 1`,
    [botId, season],
  );
  return rows[0] ? markOf(db, botId, rows[0].slot_id) : null;
}

async function latestMark(db: Queryable, botId: string): Promise<Mark | null> {
  const { rows } = await db.query<{ slot_id: string }>(
    `select m.slot_id::text as slot_id from portfolio_marks m join slots s on s.id = m.slot_id
     where m.bot_id = $1::bigint order by s.slot_time desc, s.id desc limit 1`,
    [botId],
  );
  return rows[0] ? markOf(db, botId, rows[0].slot_id) : null;
}

const closeCitation = (season: number, tx: Hex): CardCitation => ({
  event: "season_closed",
  txHash: tx,
  oracle: null,
  proves: `Season ${season}'s replay file root is on QIE: anyone can recompute these results`,
});

interface ResultRow {
  bot_id: string;
  start_value_e8: string;
  end_value_e8: string;
  return_bps: number;
  max_dd_bps: number;
  trades: number;
  battle_rank: number | null;
  is_house: boolean;
}

async function seasonCards({ db, chain, now }: CardDeps): Promise<number> {
  const { rows: seasons } = await db.query<{ id: number; root_tx: Hex }>(
    "select id, root_tx from seasons where id > 0 and status = 'closed' and root_tx is not null and ends_at > $1::timestamptz order by id", // S0 is hidden (#219)
    [new Date(now().getTime() - CLOSE_LOOKBACK_MS).toISOString()],
  );
  let made = 0;
  for (const season of seasons) {
    const { rows: results } = await db.query<ResultRow>(
      `select r.bot_id::text as bot_id, r.start_value_e8::text as start_value_e8, r.end_value_e8::text as end_value_e8,
              r.return_bps, r.max_dd_bps, r.trades, r.battle_rank, b.is_house
       from season_results r join bots b on b.id = r.bot_id where r.season_id = $1::int order by r.bot_id`,
      [season.id],
    );
    const house = results.filter((r) => r.is_house);
    const bots = new Map<string, CardBot>();
    const botOf = async (id: string) => {
      if (!bots.has(id)) bots.set(id, (await cardBot(db, id))!);
      return bots.get(id)!;
    };

    for (const r of results.filter((x) => !x.is_house)) {
      const mark = await lastMarkIn(db, r.bot_id, season.id);
      if (!mark) continue;
      const start = BigInt(r.start_value_e8);
      const end = BigInt(r.end_value_e8);
      const base = {
        schemaVersion: 1 as const,
        createdAt: now().toISOString(),
        bot: await botOf(r.bot_id),
        seasonId: season.id,
        value: await cardValue(db, chain, mark),
        change: { bps: r.return_bps, deltaE8: (end - start).toString(), since: "season" as const },
        trust: await cardTrust(db, r.bot_id),
      };

      // Battle: this bot and exactly 3 house bots (SPEC §8), in the battle's order.
      if (r.battle_rank !== null && house.length === 3) {
        const four = [r, ...house].sort((a, b) => b.return_bps - a.return_bps || a.max_dd_bps - b.max_dd_bps);
        const entries = (await Promise.all(
          four.map(async (x, i) => ({ bot: await botOf(x.bot_id), rank: (i + 1) as 1 | 2 | 3 | 4, returnBps: x.return_bps })),
        )) as [CardBattleEntry, CardBattleEntry, CardBattleEntry, CardBattleEntry];
        const battle: BattleCardPayload = {
          ...base,
          kind: "battle",
          cardId: `battle-${r.bot_id}-s${season.id}`,
          line: null,
          cites: [closeCitation(season.id, season.root_tx)],
          battle: { rank: r.battle_rank as 1 | 2 | 3 | 4, entries },
        };
        if (await saveCard(db, battle)) made++;
      }

      // Season: return, drawdown, trades, and the best and worst call priced at the season's last mark.
      const { rows: trades } = await db.query<TradeRow>(
        `select ${TRADE_COLUMNS} from trades t join decisions d on d.id = t.decision_id join slots s on s.id = d.slot_id
         where t.bot_id = $1::bigint and t.tx_hash is not null and s.season_id = $2::int order by t.block_number, t.log_index`,
        [r.bot_id, season.id],
      );
      const prices = await slotPrices(db, mark.slotId);
      const refs = [];
      for (const t of trades) {
        const ref = await callRef(db, chain, t, prices);
        if (ref) refs.push({ ref, t });
      }
      refs.sort((a, b) => b.ref.pnlBps - a.ref.pnlBps);
      const best = refs[0] ?? null;
      const worst = refs.length > 1 ? refs.at(-1)! : null;
      const season_: SeasonCardPayload = {
        ...base,
        kind: "season",
        cardId: `season-${r.bot_id}-s${season.id}`,
        line: null,
        cites: [closeCitation(season.id, season.root_tx), ...[best, worst].filter((x) => x !== null).map((x) => tradeCitation(x!.t))],
        season: { returnBps: r.return_bps, maxDdBps: r.max_dd_bps, trades: r.trades, best: best?.ref ?? null, worst: worst?.ref ?? null },
      };
      if (await saveCard(db, season_)) made++;
    }
  }
  return made;
}

async function evolutionCards({ db, chain, now }: CardDeps): Promise<number> {
  const { rows } = await db.query<{
    bot_id: string; version: number; rules: string; coin: number; trades: number; config: Partial<V2Config> | null; hash: Hex;
    tx: Hex; approved_at: Date | null; prev_rules: string; prev_coin: number; prev_trades: number;
  }>(
    `select v.bot_id::text as bot_id, v.version, v.rules_text as rules, v.max_per_coin_bps as coin, v.max_trades_per_day as trades,
            v.config_json as config, '0x' || encode(v.config_hash, 'hex') as hash, v.committed_tx as tx, v.approved_at,
            p.rules_text as prev_rules, p.max_per_coin_bps as prev_coin, p.max_trades_per_day as prev_trades
     from bot_versions v join bot_versions p on p.bot_id = v.bot_id and p.version = v.version - 1
     join bots b on b.id = v.bot_id and not b.is_house
     where v.source = 'season_v2' and v.committed_tx is not null and coalesce(v.approved_at, now()) > $1::timestamptz
       and not exists (select 1 from cards c where c.id = 'evolution-' || v.bot_id::text || '-v' || v.version::text)`,
    [new Date(now().getTime() - CLOSE_LOOKBACK_MS).toISOString()],
  );
  let made = 0;
  for (const v of rows) {
    const bot = await cardBot(db, v.bot_id);
    const mark = await latestMark(db, v.bot_id);
    if (!bot || !mark) continue;
    const because = await reasonFor(db, v.bot_id, v.config);
    const changes: CardVersionChange[] = [];
    if (v.coin !== v.prev_coin) changes.push({ setting: "max_per_coin_bps", from: v.prev_coin, to: v.coin, because });
    if (v.trades !== v.prev_trades) changes.push({ setting: "max_trades_per_day", from: v.prev_trades, to: v.trades, because });
    // Rules text is kept only when the committed hash covers it (the indexer clears it otherwise).
    if (v.rules && v.rules !== v.prev_rules) changes.push({ setting: "rules", what: v.config?.changes?.[0]?.what ?? "New rules", because });
    const startCash = await chain.startCashE8();
    const card: EvolutionCardPayload = {
      schemaVersion: 1,
      kind: "evolution",
      cardId: `evolution-${v.bot_id}-v${v.version}`,
      createdAt: now().toISOString(),
      bot,
      seasonId: await seasonAt(db, now()),
      value: await cardValue(db, chain, mark),
      change: { bps: changeBps(startCash, mark.valueE8), deltaE8: (mark.valueE8 - startCash).toString(), since: "start" },
      trust: await cardTrust(db, v.bot_id),
      line: null,
      cites: [{ event: "version_committed", txHash: v.tx, oracle: null, proves: `The owner signed version ${v.version}'s config hash on QIE` }],
      evolution: { fromVersion: v.version - 1, toVersion: v.version, configHash: v.hash, changes: changes.slice(0, 5), txHash: v.tx },
    };
    if (await saveCard(db, card)) made++;
  }
  return made;
}

/** "You said 'too risky' 3×": the chip cited most by the proposal, counted over that season's corrections; else the results. */
async function reasonFor(db: Queryable, botId: string, config: Partial<V2Config> | null) {
  const ids = (config?.changes ?? []).map((c) => c.because_correction_id).filter((id) => id > 0);
  if (ids.length > 0) {
    const { rows } = await db.query<{ chip: string; n: number }>(
      `select c.chip, (select count(*)::int from corrections x join seasons s on s.id = $3::int
                       where x.bot_id = $1::bigint and x.chip = c.chip and x.tx_hash is not null
                         and x.created_at >= s.starts_at and x.created_at < s.ends_at) as n
       from corrections c where c.bot_id = $1::bigint and c.id = any($2::bigint[]) group by c.chip order by count(*) desc, c.chip limit 1`,
      [botId, ids, config?.season ?? -1],
    );
    if (rows[0]) return { source: "corrections" as const, chip: rows[0].chip, count: Math.max(1, rows[0].n) };
  }
  return { source: "season_result" as const, text: config?.changes?.[0]?.what ?? "From the season's results" };
}

async function challengeCards({ db, chain, now }: CardDeps): Promise<number> {
  const { rows } = await db.query<{ code: Hex; season: number; challenger: string; opponent: string; winner: string; root_tx: Hex }>(
    `select c.code, c.season_id as season, c.challenger_bot::text as challenger, c.opponent_bot::text as opponent,
            c.winner_bot::text as winner, s.root_tx
     from challenges c join seasons s on s.id = c.season_id
     where c.season_id > 0 and c.status = 'settled' and c.winner_bot is not null and s.root_tx is not null and s.ends_at > $1::timestamptz
       and (not exists (select 1 from cards x where x.id = 'challenge-' || substr(c.code, 3, 16) || '-' || c.challenger_bot::text)
         or not exists (select 1 from cards x where x.id = 'challenge-' || substr(c.code, 3, 16) || '-' || c.opponent_bot::text))`,
    [new Date(now().getTime() - CLOSE_LOOKBACK_MS).toISOString()],
  );
  let made = 0;
  for (const c of rows) {
    const settleTx = await chain.challengeSettledTx(c.code, c.root_tx);
    if (!settleTx) continue;
    const side = async (botId: string) => {
      const { rows: r } = await db.query<{ return_bps: number; max_dd_bps: number }>(
        "select return_bps, max_dd_bps from season_results where season_id = $1::int and bot_id = $2::bigint",
        [c.season, botId],
      );
      return { bot: (await cardBot(db, botId))!, returnBps: r[0]?.return_bps ?? 0, maxDdBps: r[0]?.max_dd_bps ?? 0 };
    };
    const challenger = await side(c.challenger);
    const opponent = await side(c.opponent);
    for (const botId of [c.challenger, c.opponent]) {
      const mark = await lastMarkIn(db, botId, c.season);
      if (!mark) continue;
      const me = botId === c.challenger ? challenger : opponent;
      const card: ChallengeCardPayload = {
        schemaVersion: 1,
        kind: "challenge",
        cardId: `challenge-${c.code.slice(2, 18)}-${botId}`,
        createdAt: now().toISOString(),
        bot: me.bot,
        seasonId: c.season,
        value: await cardValue(db, chain, mark),
        change: { bps: me.returnBps, deltaE8: "0", since: "season" },
        trust: await cardTrust(db, botId),
        line: null,
        cites: [
          { event: "challenge_settled", txHash: settleTx, oracle: null, proves: "The winner was settled on QIE from the season's results" },
          closeCitation(c.season, c.root_tx),
        ],
        challenge: { code: c.code, challenger, opponent, winnerBotId: c.winner, txHash: settleTx },
      };
      if (await saveCard(db, card)) made++;
    }
  }
  return made;
}

async function callCards({ db, chain, now }: CardDeps): Promise<number> {
  const { rows } = await db.query<{
    bot_id: string; day: number; user_up: boolean; bot_up: boolean; user_correct: boolean | null; bot_correct: boolean | null;
    price_at_call: string; round_at_call: string; settle_price: string; settle_round: string; call_tx: Hex; settle_tx: Hex;
  }>(
    `select bot_id::text as bot_id, day, user_up, bot_up, user_correct, bot_correct,
            price_at_call_e8::text as price_at_call, round_at_call::text as round_at_call,
            settle_price_e8::text as settle_price, settle_round::text as settle_round, call_tx, settle_tx
     from daily_calls d
     where call_tx is not null and settle_tx is not null and user_up is not null and day >= $1::int
       and not exists (select 1 from cards c where c.id = 'call-' || d.bot_id::text || '-' || d.day::text)
     order by day`,
    [Math.floor((now().getTime() - CLOSE_LOOKBACK_MS) / 1000 / 86_400)],
  );
  let made = 0;
  for (const c of rows) {
    const bot = await cardBot(db, c.bot_id);
    const mark = await latestMark(db, c.bot_id);
    if (!bot || !mark) continue;

    // The season's score so far ("You 4 – AlphaWolf 3") and the owner's current streak of right calls.
    const seasonId = await seasonAt(db, new Date((c.day * 86_400 - 19_800 + 43_200) * 1000));
    let firstDay = c.day;
    if (seasonId !== null) {
      const { rows: s } = await db.query<{ starts_at: Date }>("select starts_at from seasons where id = $1::int", [seasonId]);
      firstDay = istDay(Math.floor(new Date(s[0]!.starts_at).getTime() / 1000));
    }
    const { rows: history } = await db.query<{ user_correct: boolean | null; bot_correct: boolean | null }>(
      `select user_correct, bot_correct from daily_calls
       where bot_id = $1::bigint and settle_tx is not null and call_tx is not null and day between $2::int and $3::int
       order by day`,
      [c.bot_id, firstDay, c.day],
    );
    const score = { user: history.filter((h) => h.user_correct).length, bot: history.filter((h) => h.bot_correct).length };
    let streak = 0;
    for (let i = history.length - 1; i >= 0 && history[i]!.user_correct; i--) streak++;

    const price = async (priceE8: string, roundId: string, tx: Hex): Promise<CardOraclePrice> => ({
      asset: "BTC",
      priceE8,
      roundId,
      updatedAt: (await chain.roundUpdatedAt("BTC", BigInt(roundId))).toISOString(),
      readAt: (await chain.txTime(tx)).toISOString(),
    });
    const startCash = await chain.startCashE8();
    const card: CallCardPayload = {
      schemaVersion: 1,
      kind: "call",
      cardId: `call-${c.bot_id}-${c.day}`,
      createdAt: now().toISOString(),
      bot,
      seasonId,
      value: await cardValue(db, chain, mark),
      change: { bps: changeBps(startCash, mark.valueE8), deltaE8: (mark.valueE8 - startCash).toString(), since: "start" },
      trust: await cardTrust(db, c.bot_id),
      line: null,
      cites: [
        { event: "daily_call", txHash: c.call_tx, oracle: { asset: "BTC", roundId: c.round_at_call }, proves: `The call was priced by QIE's BTC round ${c.round_at_call}` },
        { event: "daily_call_settled", txHash: c.settle_tx, oracle: { asset: "BTC", roundId: c.settle_round }, proves: `Settled by QIE's BTC round ${c.settle_round}, not by us` },
      ],
      call: {
        day: c.day,
        userUp: c.user_up,
        botUp: c.bot_up,
        userCorrect: c.user_correct === true,
        botCorrect: c.bot_correct === true,
        priceAtCall: await price(c.price_at_call, c.round_at_call, c.call_tx),
        settlePrice: await price(c.settle_price, c.settle_round, c.settle_tx),
        score,
        streak,
        callTxHash: c.call_tx,
        settleTxHash: c.settle_tx,
      },
    };
    if (await saveCard(db, card)) made++;
  }
  return made;
}
