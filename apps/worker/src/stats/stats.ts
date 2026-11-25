import type { Queryable } from "../scheduler/db";

/**
 * /stats numbers (SPEC §11 user-signed tx metric, §12.4 traction). Every number is a count over rows the indexer
 * wrote from contract events, so anyone can recount it from QIE mainnet logs. Optimistic rows (tx still null) never count.
 *
 * User-signed = one of the actions below. Each contract checks `_msgSender() == bot owner` before it emits the
 * event, so the wallet is the signer of the forwarded request (or the direct caller), never our relayer or runner.
 * House bots are left out: their owner is the admin key.
 *
 *   createBot       bots.created_tx                 BotRegistry.BotCreated        wallet = owner_wallet, time = block time
 *   approveV2       bot_versions.committed_tx, v≥2  SeasonLedger.VersionCommitted wallet = bot owner,    time = block time
 *   correction      corrections.tx_hash             SeasonLedger.CallCorrected    wallet = user_wallet,  time = block time
 *   bigMove         big_moves.user_tx               PaperLedger.ApprovedTrade     wallet = bot owner,    time = when proposed (≤ 2 h before)
 *   dailyCall       daily_calls.call_tx             DailyCall.Called              wallet = user_wallet,  time = 00:00 IST of the call's day
 *   challengeCreate challenges.create_tx            Challenges.ChallengeCreated   wallet = challenger bot owner, no time stored
 *   challengeAccept challenges.accept_tx            Challenges.ChallengeAccepted  wallet = opponent bot owner,   no time stored
 *
 * Challenges have no time in the (frozen) schema, so they count toward totals but not toward the 7/30-day or
 * season-based numbers: those undercount, never overcount. BotRegistry.setActive (pause) writes no row, so it isn't counted.
 *
 * System = txs our keys send, shown apart and never added to the user numbers:
 *   runnerTrades     distinct trades.tx_hash not equal to any big_moves.user_tx (executeBatch with ≥ 1 Trade)
 *   dailyCallSettles distinct daily_calls.settle_tx (DailyCall.Settled)
 *   seasonCloses     seasons.root_tx (SeasonLedger.SeasonClosed)
 *   scoreCommits     seasons.scores_tx (latest TrustScoreRegistry.ScoresCommitted per season)
 *   houseBots        house bots' BotCreated and VersionCommitted txs (admin)
 * Not stored, so not counted: batches where every order was skipped, SeasonOpened, ChallengeSettled/Expired, RulesPublished.
 */

const USER_ACTIONS = `
  user_actions (action, wallet, tx, at) as (
    select 'createBot', b.owner_wallet::text, b.created_tx::text, b.created_at
    from bots b where b.created_tx is not null and not b.is_house
    union all
    select 'approveV2', b.owner_wallet, v.committed_tx, v.approved_at
    from bot_versions v join bots b on b.id = v.bot_id
    where v.version >= 2 and v.committed_tx is not null and not b.is_house
    union all
    select 'correction', c.user_wallet, c.tx_hash, c.created_at
    from corrections c join bots b on b.id = c.bot_id
    where c.tx_hash is not null and not b.is_house
    union all
    select 'bigMove', b.owner_wallet, m.user_tx, m.created_at
    from big_moves m join bots b on b.id = m.bot_id
    where m.user_tx is not null and not b.is_house
    union all
    select 'dailyCall', d.user_wallet, d.call_tx, to_timestamp(d.day::bigint * 86400 - 19800)
    from daily_calls d join bots b on b.id = d.bot_id
    where d.call_tx is not null and d.user_wallet is not null and not b.is_house
    union all
    select 'challengeCreate', b.owner_wallet, c.create_tx, null::timestamptz
    from challenges c join bots b on b.id = c.challenger_bot
    where c.create_tx is not null and not b.is_house
    union all
    select 'challengeAccept', b.owner_wallet, c.accept_tx, null::timestamptz
    from challenges c join bots b on b.id = c.opponent_bot
    where c.accept_tx is not null and not b.is_house
  )`;

const SYSTEM_TXS = `
  system_txs (kind, tx) as (
    select 'runnerTrades', t.tx_hash::text from trades t
    where t.tx_hash is not null and not exists (select 1 from big_moves m where m.user_tx = t.tx_hash)
    union all
    select 'dailyCallSettles', settle_tx from daily_calls where settle_tx is not null
    union all
    select 'seasonCloses', root_tx from seasons where root_tx is not null
    union all
    select 'scoreCommits', scores_tx from seasons where scores_tx is not null
    union all
    select 'houseBots', b.created_tx from bots b where b.is_house and b.created_tx is not null
    union all
    select 'houseBots', v.committed_tx from bot_versions v join bots b on b.id = v.bot_id
    where b.is_house and v.version >= 2 and v.committed_tx is not null
  )`;

// $1 = now. Seasons from S1: S0 is the hidden test season.
const TOTALS_SQL = `
  with ${USER_ACTIONS},
  season_wallets as (
    select a.wallet from user_actions a
    join seasons s on s.id > 0 and a.at >= s.starts_at and a.at < s.ends_at
    group by a.wallet having count(distinct s.id) >= 2
  )
  select
    count(distinct tx)::int as txs,
    count(distinct wallet)::int as signers,
    count(distinct wallet) filter (where at > $1::timestamptz - interval '7 days' and at <= $1::timestamptz)::int as active_7d,
    count(distinct wallet) filter (where at > $1::timestamptz - interval '30 days' and at <= $1::timestamptz)::int as active_30d,
    (select count(*)::int from season_wallets) as recurring
  from user_actions`;

const BY_ACTION_SQL = `
  with ${USER_ACTIONS}
  select action, count(distinct tx)::int as txs, count(distinct wallet)::int as wallets
  from user_actions group by action`;

const SYSTEM_SQL = `
  with ${SYSTEM_TXS}
  select kind, count(distinct tx)::int as txs from system_txs group by kind
  union all
  select 'total', count(distinct tx)::int from system_txs`;

export const USER_ACTION_KINDS = [
  "createBot",
  "approveV2",
  "correction",
  "bigMove",
  "dailyCall",
  "challengeCreate",
  "challengeAccept",
] as const;
export const SYSTEM_KINDS = ["runnerTrades", "dailyCallSettles", "seasonCloses", "scoreCommits", "houseBots"] as const;

export type UserActionKind = (typeof USER_ACTION_KINDS)[number];
export type SystemKind = (typeof SYSTEM_KINDS)[number];

export interface ActivityStats {
  asOf: string;
  userSigned: {
    /** Distinct user-signed txs. */
    txs: number;
    /** Distinct wallets with ≥ 1 user-signed tx. */
    signers: number;
    /** Distinct wallets with a timed user-signed tx in the last 7 / 30 days. */
    active7d: number;
    active30d: number;
    /** Distinct wallets with timed user-signed txs in ≥ 2 seasons (S1 on). */
    recurring: number;
    byAction: Record<UserActionKind, { txs: number; wallets: number }>;
  };
  system: { txs: number; byKind: Record<SystemKind, number> };
}

export async function activityStats(db: Queryable, now: Date): Promise<ActivityStats> {
  const [totals, byAction, system] = await Promise.all([
    db.query<{ txs: number; signers: number; active_7d: number; active_30d: number; recurring: number }>(TOTALS_SQL, [now.toISOString()]),
    db.query<{ action: UserActionKind; txs: number; wallets: number }>(BY_ACTION_SQL),
    db.query<{ kind: SystemKind | "total"; txs: number }>(SYSTEM_SQL),
  ]);
  const t = totals.rows[0]!;
  const actions = Object.fromEntries(USER_ACTION_KINDS.map((k) => [k, { txs: 0, wallets: 0 }])) as ActivityStats["userSigned"]["byAction"];
  for (const r of byAction.rows) actions[r.action] = { txs: r.txs, wallets: r.wallets };
  const kinds = Object.fromEntries(SYSTEM_KINDS.map((k) => [k, 0])) as Record<SystemKind, number>;
  let systemTxs = 0;
  for (const r of system.rows) {
    if (r.kind === "total") systemTxs = r.txs;
    else kinds[r.kind] = r.txs;
  }
  return {
    asOf: now.toISOString(),
    userSigned: { txs: t.txs, signers: t.signers, active7d: t.active_7d, active30d: t.active_30d, recurring: t.recurring, byAction: actions },
    system: { txs: systemTxs, byKind: kinds },
  };
}
