-- BotFolio database schema (Supabase Postgres). FROZEN INTERFACE — change only via one announced PR.
-- Source of truth: SPEC.md §3 (v1.1, incl. the Nov 20 review additions). Queries it serves: §6–§9, §11.
--
-- This file is the full current schema. packages/db/migrations/ holds the same thing as ordered steps
-- (0001_init.sql = this file at freeze time). Any later change goes into BOTH: a new migration and this file.
--
-- Conventions
--   * Money: on-chain values are "play USDT" with 8 decimals (`*_e8`, same scale as the QIE feeds);
--     units are 18 decimals (`*_e18`). Stored as `numeric` so uint256 values never overflow.
--     The ₹ figure is display-only: displayINR = 100000 × value / startValue (SPEC §3), never stored here.
--   * Addresses, tx hashes, bytes32 hex codes: lowercase 0x-hex text (checked by the domains below),
--     so joins on wallet_address never miss on checksum casing.
--   * bytes32 values (hashes, roots, order ids): `bytea` of exactly 32 bytes.
--   * Times: timestamptz. "day" columns are IST day numbers: floor((unix_seconds + 19800) / 86400),
--     the same formula the contracts use (SPEC §4.3, §4.7).
--   * Indexer source of truth = chain events. `trades`, `bots`, `bot_versions.committed_tx` and
--     `corrections.tx_hash` are written only from indexed events, plus optimistic UI rows: a row whose
--     tx/block column is still null is pending (SPEC §3).
--   * Public reads: the web reads only the `site_*` views (SPEC §3, §11). The access-control section at
--     the bottom makes them the only anon surface; base tables stay service-role only.

-- ---------------------------------------------------------------------------------------------------
-- Domains
-- ---------------------------------------------------------------------------------------------------

create domain bytes32 as bytea check (octet_length(value) = 32);
create domain eth_address as text check (value ~ '^0x[0-9a-f]{40}$');
create domain tx_hash as text check (value ~ '^0x[0-9a-f]{64}$');

-- ---------------------------------------------------------------------------------------------------
-- Enums (values exactly as SPEC §3)
-- ---------------------------------------------------------------------------------------------------

create type asset_id as enum ('BTC', 'ETH', 'SOL', 'XRP', 'GOLD');          -- on-chain index 0..4, same order
create type trade_side as enum ('BUY', 'SELL');
create type bot_status as enum ('active', 'paused', 'banned');
create type version_source as enum ('create', 'season_v2');
create type slot_kind as enum ('scheduled', 'debut');
create type decision_status as enum ('executed', 'held', 'skipped_stale', 'invalid');
create type season_status as enum ('open', 'closing', 'closed');
create type season_kind as enum ('sprint', 'weekly');                         -- v1.1
create type card_kind as enum ('trade', 'roast', 'battle', 'season', 'recap', 'evolution', 'challenge', 'call');
create type big_move_status as enum ('pending', 'approved', 'shrunk', 'blocked', 'expired');  -- v1.1
create type challenge_status as enum ('open', 'accepted', 'settled', 'expired');              -- v1.1
create type login_method as enum ('passkey', 'qie_wallet');                                   -- v1.1
-- Not enumerated in SPEC §3; values match the POST /relay outcome in packages/shared/src/relay.ts.
create type relay_status as enum ('rejected', 'submitted', 'confirmed', 'reverted');

-- ---------------------------------------------------------------------------------------------------
-- Users (never anon-readable, SPEC §3/§11)
-- ---------------------------------------------------------------------------------------------------

create table users (
  id                uuid primary key default gen_random_uuid(),
  wallet_address    eth_address not null unique,
  privy_did         text unique,                            -- null for QIE Wallet logins
  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz,
  flags             jsonb not null default '{}'::jsonb,
  -- v1.1
  login_method      login_method not null default 'passkey',
  pass_verified     boolean not null default false,         -- QIE Pass "verified human" (behind PASS_ENABLED)
  pass_verified_at  timestamptz,
  terms_accepted_at timestamptz not null                    -- 18+ and Terms one-line confirmation at sign-up (§11)
);
comment on table users is 'One row per wallet that signed in. Stores wallet + Privy DID only (§11 privacy). Never anon-readable.';
comment on column users.terms_accepted_at is 'Set when the user confirms they are 18+ and accept the Terms (SPEC §3, §11).';

-- ---------------------------------------------------------------------------------------------------
-- Seasons (config, not code: boundaries live here, SPEC §1, §6.1)
-- ---------------------------------------------------------------------------------------------------

create table seasons (
  id                     int primary key,                   -- season number n (S0 = 0, hidden test season)
  starts_at              timestamptz not null,
  ends_at                timestamptz not null,              -- close time (21:30 IST); last slot is 21:00 that day
  status                 season_status not null default 'open',
  data_root              bytes32,                           -- Merkle root over the replay file (§6.5)
  data_uri               text,                              -- replay file URL (Supabase public storage)
  root_tx                tx_hash,                           -- SeasonLedger.closeSeason
  trust_rules_version    text,                              -- e.g. trust-v1-sprint / trust-v1 (§7)
  scores_root            bytes32,                           -- TrustScoreRegistry.commitScores root
  scores_tx              tx_hash,
  -- v1.1
  kind                   season_kind not null,
  provisional_min_trades int not null,                      -- 8 during sprint seasons, 20 from S6 (§7)
  check (ends_at > starts_at)
);
comment on table seasons is 'Season boundaries and the on-chain roots committed at close. Sprint vs weekly is data, not code.';

-- ---------------------------------------------------------------------------------------------------
-- Bots and versions (written from BotRegistry / SeasonLedger events)
-- ---------------------------------------------------------------------------------------------------

create table bots (
  id            bigint primary key,                         -- = on-chain botId (BotRegistry.nextBotId)
  owner_wallet  eth_address not null,                       -- MVP: 1 bot per wallet, enforced on-chain (botOf)
  name          text not null,
  emoji         text not null,
  persona_text  text not null,
  persona_hash  bytes32 not null,
  created_at    timestamptz not null default now(),
  created_tx    tx_hash,                                    -- null = optimistic row, not yet indexed
  is_house      boolean not null default false,             -- Steady Sam, Gold Granny, Momentum Max (§8)
  status        bot_status not null default 'active'
);
comment on table bots is 'One row per on-chain bot. id is the on-chain botId.';

create table bot_versions (
  bot_id             bigint not null references bots(id),
  version            int not null check (version >= 1),
  rules_text         text not null,
  max_per_coin_bps   int not null check (max_per_coin_bps between 1000 and 5000),  -- same bounds as createBot/setLimits
  max_trades_per_day int not null check (max_trades_per_day between 1 and 8),
  config_json        jsonb not null,
  config_hash        bytes32 not null,
  source             version_source not null,
  committed_tx       tx_hash,                               -- null = proposed (v2 diff shown) but not committed
  approved_at        timestamptz,
  primary key (bot_id, version)
);
comment on table bot_versions is 'Every version of a bot''s brain. v1 from createBot; v2+ from SeasonLedger.commitVersion (§2.3).';

-- ---------------------------------------------------------------------------------------------------
-- Slots, oracle reads, decisions (runner, SPEC §5, §6)
-- ---------------------------------------------------------------------------------------------------

create table slots (
  id         bigint generated always as identity primary key,
  slot_time  timestamptz not null,                          -- 09:00 / 13:00 / 17:00 / 21:00 IST, or debut time
  kind       slot_kind not null,
  season_id  int references seasons(id)                     -- null outside any season (e.g. before S0)
);
comment on table slots is 'Idempotency key for every runner job (§6.1). One scheduled row per slot time; debut slots are per new bot.';

create table oracle_reads (
  slot_id     bigint not null references slots(id),
  asset       asset_id not null,
  feed        eth_address not null,                         -- one of the 5 feeds in SPEC §0.2
  round_id    numeric not null,                             -- uint80
  answer      numeric not null,                             -- 8 decimals
  updated_at  timestamptz not null,                         -- feed updatedAt
  fresh       boolean not null,                             -- within max age (30 min crypto, 6 h gold)
  primary key (slot_id, asset)                              -- latest valid answer per asset per slot (§5.6); retries upsert
);
comment on table oracle_reads is 'Off-chain oracle reads used for prompts and marks; replayable via getRoundData(round_id) (§5.6).';

create table decisions (
  id               uuid primary key default gen_random_uuid(),
  bot_id           bigint not null references bots(id),
  version          int not null,
  slot_id          bigint not null references slots(id),
  prompt_version   text not null,                           -- e.g. prompt-v1
  model            text not null,                           -- logged model id (or 'house-rules' for house bots)
  input_json       jsonb not null,
  input_hash       bytes32 not null,
  raw_output_json  jsonb,                                   -- null if the LLM call failed
  output_hash      bytes32,
  gate_result      jsonb,                                   -- orders, clips ("gate events", F1), big-move splits
  reason           text,
  reason_tag       text,                                    -- §6.3 enum, validated by gate(); text so new tags need no migration
  roast            text,
  status           decision_status not null,
  created_at       timestamptz not null default now(),
  foreign key (bot_id, version) references bot_versions(bot_id, version),
  unique (bot_id, slot_id)                                  -- one decision per bot per slot: re-runs are no-ops (§6.1)
);
comment on table decisions is 'One row per bot per slot, incl. HOLD / skipped / invalid. Off-chain; sealed by the season data root.';

-- ---------------------------------------------------------------------------------------------------
-- Trades and marks (trades written from PaperLedger Trade events)
-- ---------------------------------------------------------------------------------------------------

create table trades (
  id            bigint generated always as identity primary key,
  decision_id   uuid not null references decisions(id),
  action_index  int not null check (action_index between 0 and 2),   -- position in the decision's actions[] (max 3)
  order_id      bytes32 not null unique,                    -- keccak256(abi.encode(decisionId, actionIndex)) (§3)
  bot_id        bigint not null references bots(id),
  asset         asset_id not null,
  side          trade_side not null,
  cash_e8       numeric not null,
  units_e18     numeric not null,
  price_e8      numeric not null,                           -- read by the contract from the oracle, never passed in
  round_id      numeric not null,
  tx_hash       tx_hash,                                    -- null = optimistic row, not yet indexed
  log_index     int,
  block_number  bigint,
  unique (tx_hash, log_index)                               -- indexer idempotency
);
comment on table trades is 'Every on-chain Trade event (executeBatch or executeApproved). order_id is the per-order replay key shared by both paths.';

create table portfolio_marks (
  bot_id    bigint not null references bots(id),
  slot_id   bigint not null references slots(id),
  cash_e8   numeric not null,
  holdings  jsonb not null,                                 -- {"GOLD": {"units_e18": "...", "value_e8": "..."}, ...}
  value_e8  numeric not null,
  primary key (bot_id, slot_id)
);
comment on table portfolio_marks is 'Portfolio value at each slot, priced with that slot''s oracle_reads (§5.6). Feeds returns, Sortino, drawdown, trust F2/F3.';

-- ---------------------------------------------------------------------------------------------------
-- Coaching (SeasonLedger.recordCorrection, user-signed)
-- ---------------------------------------------------------------------------------------------------

create table corrections (
  id          bigint generated always as identity primary key,
  bot_id      bigint not null references bots(id),
  decision_id uuid not null references decisions(id),
  user_wallet eth_address not null,                         -- _msgSender of the correction
  chip        text not null,                                -- too risky / too timid / wrong coin / sold too early / blocked
  note        text check (note is null or char_length(note) <= 80),
  note_hash   bytes32,                                      -- only the hash goes on-chain
  tx_hash     tx_hash,                                      -- null = optimistic row, not yet indexed
  created_at  timestamptz not null default now()
);
comment on table corrections is '"Bad call" taps and Approve-Big-Move blocks. Note text stays off-chain; the event carries note_hash.';

-- ---------------------------------------------------------------------------------------------------
-- Season results, trust scores (season close, SPEC §7, §8)
-- ---------------------------------------------------------------------------------------------------

create table season_results (
  season_id       int not null references seasons(id),
  bot_id          bigint not null references bots(id),
  start_value_e8  numeric not null,                         -- value at season open, or at creation if joined mid-season
  end_value_e8    numeric not null,
  return_bps      int not null,
  sortino         numeric,                                  -- null when not eligible (< 3 trades or < 3 daily returns)
  max_dd_bps      int not null,
  trades          int not null,
  battle_rank     int check (battle_rank between 1 and 4),  -- vs the 3 house bots; null for house bots
  primary key (season_id, bot_id)
);

create table trust_scores (
  season_id     int not null references seasons(id),
  bot_id        bigint not null references bots(id),
  rules_version text not null,                              -- trust-v1-sprint / trust-v1
  f_rules       int not null check (f_rules between 0 and 250),
  f_drawdown    int not null check (f_drawdown between 0 and 250),
  f_consistency int not null check (f_consistency between 0 and 250),
  f_explains    int not null check (f_explains between 0 and 250),
  total         int not null check (total between 0 and 1000),
  provisional   boolean not null,
  leaf_hash     bytes32 not null,                           -- keccak256(abi.encode(season, botId, f1..f4, total)) (§4.5)
  primary key (season_id, bot_id),
  check (total = f_rules + f_drawdown + f_consistency + f_explains)
);

-- ---------------------------------------------------------------------------------------------------
-- Share cards (SPEC §9; payload type = packages/shared/src/cards.ts)
-- ---------------------------------------------------------------------------------------------------

create table cards (
  id          text primary key,                             -- cardId used in /card/[cardId] and /api/card/[cardId]
  bot_id      bigint not null references bots(id),
  kind        card_kind not null,
  payload     jsonb not null,                               -- CardPayload; includes the tx hashes the card cites
  created_at  timestamptz not null default now()
);
comment on table cards is 'Immutable per id (CDN-cached 1 year). Data only from indexed records + logged decision text.';

-- ---------------------------------------------------------------------------------------------------
-- Relay log (never anon-readable; source of the user-signed metric, SPEC §11)
-- ---------------------------------------------------------------------------------------------------

create table relay_log (
  id          bigint generated always as identity primary key,
  user_wallet eth_address not null,                         -- ForwardRequest.from = _msgSender
  target      eth_address,                                  -- ForwardRequest.to (null if the body did not parse)
  selector    text check (selector ~ '^0x[0-9a-f]{8}$'),
  status      relay_status not null,
  tx_hash     tx_hash,
  gas_used    bigint,
  created_at  timestamptz not null default now()
);
comment on table relay_log is 'Every POST /relay attempt. Rate limits (30/user/day, 2000/hour global) count rows here.';

-- ---------------------------------------------------------------------------------------------------
-- v1.1: Approve Big Move, Daily Call, Challenges, .qie names
-- ---------------------------------------------------------------------------------------------------

create table big_moves (
  id            bigint generated always as identity primary key,
  decision_id   uuid not null references decisions(id),
  action_index  int not null check (action_index between 0 and 2),
  order_id      bytes32 not null unique,                    -- same orderId the clipped fallback reuses (§6.4 step 10)
  bot_id        bigint not null references bots(id),
  asset         asset_id not null,
  side          trade_side not null,
  bps           int not null check (bps between 1 and 10000),
  runner_sig    bytea not null,                             -- EIP-712 ApprovedOrder signature. NEVER anon-readable.
  deadline      timestamptz not null,                       -- now + 2 h (BIG_MOVE_TTL_MIN)
  status        big_move_status not null default 'pending',
  user_tx       tx_hash,                                    -- PaperLedger.executeApproved tx, when allowed
  created_at    timestamptz not null default now()
);
comment on table big_moves is 'Orders split out by gate() step 9 that need the owner''s signature (Allow / Shrink / Block).';

create table daily_calls (
  id               bigint generated always as identity primary key,
  bot_id           bigint not null references bots(id),
  user_wallet      eth_address,                             -- null until the owner makes the call
  day              int not null,                            -- IST day number
  asset            asset_id not null default 'BTC',         -- fixed to BTC for MVP (§4.7)
  user_up          boolean,                                 -- null until the owner makes the call
  bot_up           boolean not null,                        -- bot view from the 09:00 (or debut) decision
  bot_up_sig       bytea not null,                          -- runner EIP-712 sig over (botId, day, botUp). NEVER anon-readable.
  price_at_call_e8 numeric,
  round_at_call    numeric,
  settle_price_e8  numeric,
  settle_round     numeric,
  user_correct     boolean,                                 -- null = not settled, or equal price (no winner)
  bot_correct      boolean,
  call_tx          tx_hash,
  settle_tx        tx_hash,
  unique (bot_id, day)                                      -- one call per bot per IST day (§4.7)
);
comment on table daily_calls is 'Row is created when the runner signs the bot view; the user half is filled when DailyCall.call is indexed.';

create table challenges (
  code          text primary key check (code ~ '^0x[0-9a-f]{64}$'),  -- full bytes32 code from ChallengeCreated
  season_id     int not null references seasons(id),
  challenger_bot bigint not null references bots(id),
  opponent_bot  bigint references bots(id),
  create_tx     tx_hash,
  accept_tx     tx_hash,
  status        challenge_status not null default 'open',
  winner_bot    bigint references bots(id),
  check (opponent_bot is null or opponent_bot <> challenger_bot)
);
comment on table challenges is 'Bot-vs-bot links. Share links use the first 8 bytes of code; resolve with site_challenge_by_short_code.';

create table qie_names (
  wallet_address eth_address primary key,
  qie_name       text,                                      -- null = no reverse record
  checked_at     timestamptz not null default now()         -- 24 h TTL
);
comment on table qie_names is 'Cache of .qie reverse lookups (QIE Wallet MCP), refreshed after 24 h.';

-- ---------------------------------------------------------------------------------------------------
-- Indexes (named after the query they serve)
-- ---------------------------------------------------------------------------------------------------

-- §2.1 / indexer: bot by owner (relay checks, /me)
create index bots_owner_wallet_idx on bots (owner_wallet);
-- §6.1: the scheduled slot for a time is unique, so a duplicate trigger finds the existing row
create unique index slots_scheduled_time_uidx on slots (slot_time) where kind = 'scheduled';
create index slots_season_time_idx on slots (season_id, slot_time);
-- /bot/[botId] and /me: decisions newest first; slot fan-out for a run
create index decisions_bot_created_idx on decisions (bot_id, created_at desc);
create index decisions_slot_idx on decisions (slot_id);
-- /bot/[botId] trade list, latest-trades feed, card citations
create index trades_bot_block_idx on trades (bot_id, block_number desc);
create index trades_decision_idx on trades (decision_id);
create index trades_block_idx on trades (block_number desc);
-- §8 live leaderboards: all marks of one slot
create index portfolio_marks_slot_idx on portfolio_marks (slot_id);
-- §2.3 v2 proposal: corrections of a bot in a season window; 20/day rate limit
create index corrections_bot_created_idx on corrections (bot_id, created_at);
create index corrections_decision_idx on corrections (decision_id);
-- §8 boards from season results / trust scores
create index season_results_return_idx on season_results (season_id, return_bps desc);
create index season_results_sortino_idx on season_results (season_id, sortino desc nulls last);
create index trust_scores_total_idx on trust_scores (season_id, total desc);
create index trust_scores_bot_idx on trust_scores (bot_id, season_id desc);
-- §9 cards of a bot
create index cards_bot_created_idx on cards (bot_id, created_at desc);
-- §11 rate limits: per wallet per day, global per hour
create index relay_log_wallet_created_idx on relay_log (user_wallet, created_at);
create index relay_log_created_idx on relay_log (created_at);
-- §6.1 big-move expiry sweep (every 10 min) and the /me Allow prompt
create index big_moves_pending_deadline_idx on big_moves (deadline) where status = 'pending';
create index big_moves_bot_idx on big_moves (bot_id, created_at desc);
-- §6.1 DailyCall settle job: called but not yet settled, by day
create index daily_calls_unsettled_idx on daily_calls (day) where call_tx is not null and settle_tx is null;
-- §2.5 short-link resolve (first 8 bytes = 16 hex chars after 0x), max 10 open per bot, season close
create index challenges_short_code_idx on challenges (substring(code from 3 for 16));
create index challenges_open_by_bot_idx on challenges (challenger_bot) where status = 'open';
create index challenges_season_idx on challenges (season_id);

-- ---------------------------------------------------------------------------------------------------
-- Public read surface: the only things the web (anon key) may read (SPEC §3, §11)
-- Views run with the owner's rights (no security_invoker), so anon needs SELECT on the view only.
-- They leave out users, relay_log rows, big_moves.runner_sig, daily_calls.bot_up_sig and correction notes.
-- Grants and RLS are in the access-control section at the end of this file.
-- ---------------------------------------------------------------------------------------------------

create view site_bots as
select b.id, b.owner_wallet, q.qie_name as owner_qie_name, b.name, b.emoji, b.persona_text, b.persona_hash,
       b.created_at, b.created_tx, b.is_house, b.status
from bots b
left join qie_names q on q.wallet_address = b.owner_wallet;

create view site_bot_versions as
select bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash,
       source, committed_tx, approved_at
from bot_versions
where committed_tx is not null or source = 'create';

-- Full LLM input/output stays in the public replay file; the page only needs reason, hashes and gate result.
create view site_decisions as
select d.id, d.bot_id, d.version, d.slot_id, s.slot_time, s.kind as slot_kind, d.prompt_version, d.model,
       d.input_hash, d.output_hash, d.gate_result, d.reason, d.reason_tag, d.roast, d.status, d.created_at
from decisions d
join slots s on s.id = d.slot_id;

create view site_trades as
select id, decision_id, action_index, order_id, bot_id, asset, side, cash_e8, units_e18, price_e8,
       round_id, tx_hash, log_index, block_number
from trades
where tx_hash is not null;

-- Latest-trades feed on the site home (name proposed in website-export/apps/web/lib/site/data.ts)
create view site_latest_trades as
select t.id, t.bot_id, b.name as bot_name, b.emoji as bot_emoji, b.is_house, t.asset, t.side, t.cash_e8,
       t.units_e18, t.price_e8, t.round_id, t.tx_hash, t.block_number, d.reason
from trades t
join bots b on b.id = t.bot_id
join decisions d on d.id = t.decision_id
where t.tx_hash is not null
order by t.block_number desc, t.log_index desc
limit 50;

create view site_oracle_reads as
select r.slot_id, s.slot_time, r.asset, r.feed, r.round_id, r.answer, r.updated_at, r.fresh
from oracle_reads r
join slots s on s.id = r.slot_id;

create view site_portfolio_marks as
select m.bot_id, m.slot_id, s.slot_time, m.cash_e8, m.holdings, m.value_e8
from portfolio_marks m
join slots s on s.id = m.slot_id;

create view site_corrections as
select id, bot_id, decision_id, chip, note_hash, tx_hash, created_at
from corrections
where tx_hash is not null;

create view site_seasons as
select id, starts_at, ends_at, status, kind, provisional_min_trades, data_root, data_uri, root_tx,
       trust_rules_version, scores_root, scores_tx
from seasons
where id > 0;                                               -- S0 is the hidden test season

create view site_season_results as
select season_id, bot_id, start_value_e8, end_value_e8, return_bps, sortino, max_dd_bps, trades, battle_rank
from season_results;

create view site_trust_scores as
select season_id, bot_id, rules_version, f_rules, f_drawdown, f_consistency, f_explains, total,
       provisional, leaf_hash
from trust_scores;

create view site_cards as
select id, bot_id, kind, payload, created_at
from cards;

create view site_big_moves as
select id, decision_id, action_index, order_id, bot_id, asset, side, bps, deadline, status, user_tx, created_at
from big_moves;

-- bot_up is the bot's answer: hidden until the owner's own call is on-chain, so nobody can peek first (§2.2).
create view site_daily_calls as
select id, bot_id, user_wallet, day, asset, user_up,
       case when call_tx is not null then bot_up end as bot_up,
       price_at_call_e8, round_at_call, settle_price_e8, settle_round, user_correct, bot_correct,
       call_tx, settle_tx
from daily_calls;

create view site_challenges as
select code, substring(code from 1 for 18) as short_code, season_id, challenger_bot, opponent_bot,
       create_tx, accept_tx, status, winner_bot
from challenges;

-- /stats (§11): user-signed activity counted by _msgSender, shown apart from system txs. Never mixed.
create view site_activity_stats as
select
  (select count(*) from relay_log where status = 'confirmed')                                   as user_signed_txs,
  (select count(distinct user_wallet) from relay_log where status = 'confirmed')                as unique_signers,
  (select count(distinct user_wallet) from relay_log
     where status = 'confirmed' and created_at > now() - interval '7 days')                     as signers_7d,
  (select count(distinct t.tx_hash) from trades t
     where t.tx_hash is not null
       and not exists (select 1 from big_moves m where m.user_tx = t.tx_hash))                  as system_trade_txs,
  (select count(distinct settle_tx) from daily_calls where settle_tx is not null)
  + (select count(root_tx) from seasons) + (select count(scores_tx) from seasons)               as system_other_txs;

-- Short challenge link → full code (§2.5). Input: 16 hex chars, with or without 0x.
create function site_challenge_by_short_code(short_code text)
returns setof site_challenges
language sql stable
as $$
  select * from site_challenges
  where substring(code from 3 for 16) = lower(right(short_code, 16));
$$;

-- Season leaderboards (§8). Proposed as an RPC in website-export/apps/web/lib/site/data.ts.
-- Reads only site_* views, so it needs no rights beyond theirs (no security definer).
-- Ranking/eligibility (Sortino: ≥ 3 trades + 3 daily returns; Most Trusted: not provisional) is applied
-- by the caller from these columns; house bots are included with is_house so the UI can badge them.
create function site_leaderboards(season int)
returns table (
  bot_id bigint, bot_name text, bot_emoji text, is_house boolean, owner_qie_name text, created_at timestamptz,
  return_bps int, sortino numeric, max_dd_bps int, trades int, battle_rank int,
  trust_total int, trust_provisional boolean
)
language sql stable
as $$
  select r.bot_id, b.name, b.emoji, b.is_house, b.owner_qie_name, b.created_at,
         r.return_bps, r.sortino, r.max_dd_bps, r.trades, r.battle_rank,
         t.total, t.provisional
  from site_season_results r
  join site_bots b on b.id = r.bot_id
  left join site_trust_scores t on t.season_id = r.season_id and t.bot_id = r.bot_id
  where r.season_id = site_leaderboards.season
  order by r.return_bps desc, r.max_dd_bps asc;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Access control: deny by default (SPEC §3, §11)
-- Supabase's default privileges give anon and authenticated ALL on every new table, view and sequence
-- in `public`. Without this section the public key can read and write every table. The views need the
-- revoke as well: simple views are writable and run as their owner, so they would bypass table RLS.
-- RLS has no policies on purpose: only the service role (bypassrls) and the owner get through.
-- Any later migration that adds a table or view must repeat both steps for it.
-- ---------------------------------------------------------------------------------------------------

alter table users enable row level security;
alter table seasons enable row level security;
alter table bots enable row level security;
alter table bot_versions enable row level security;
alter table slots enable row level security;
alter table oracle_reads enable row level security;
alter table decisions enable row level security;
alter table trades enable row level security;
alter table portfolio_marks enable row level security;
alter table corrections enable row level security;
alter table season_results enable row level security;
alter table trust_scores enable row level security;
alter table cards enable row level security;
alter table relay_log enable row level security;
alter table big_moves enable row level security;
alter table daily_calls enable row level security;
alter table challenges enable row level security;
alter table qie_names enable row level security;

do $$
declare
  api_role text;
begin
  -- The roles exist on Supabase, not on plain Postgres (local tests), hence the lookup.
  for api_role in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
    execute format('revoke all on
    users, seasons, bots, bot_versions,
    slots, oracle_reads, decisions, trades,
    portfolio_marks, corrections, season_results, trust_scores,
    cards, relay_log, big_moves, daily_calls,
    challenges, qie_names,
    site_bots, site_bot_versions, site_decisions, site_trades,
    site_latest_trades, site_oracle_reads, site_portfolio_marks, site_corrections,
    site_seasons, site_season_results, site_trust_scores, site_cards,
    site_big_moves, site_daily_calls, site_challenges, site_activity_stats
    from %I', api_role);
    execute format('revoke all on all sequences in schema public from %I', api_role);
    execute format('grant select on
    site_bots, site_bot_versions, site_decisions, site_trades,
    site_latest_trades, site_oracle_reads, site_portfolio_marks, site_corrections,
    site_seasons, site_season_results, site_trust_scores, site_cards,
    site_big_moves, site_daily_calls, site_challenges, site_activity_stats
    to %I', api_role);
    execute format('grant execute on function
    site_challenge_by_short_code(text), site_leaderboards(int)
    to %I', api_role);
  end loop;
end
$$;
