import type { PGlite } from "@electric-sql/pglite";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HealthState } from "../../src/health";
import { fetchStats } from "../../../web/lib/stats";
import type { Queryable } from "../../src/scheduler/db";
import { createWorkerServer } from "../../src/server";
import { STATS_CACHE_MS, STATS_PER_IP_PER_MINUTE, statsRoutes, type StatsRouteOptions } from "../../src/stats/route";
import { activityStats, type ActivityStats } from "../../src/stats/stats";
import { testDb } from "../decisions/helpers";

// testDb: bots 7 and 8, owned by 0x…07 (A) and 0x…08 (B), both still optimistic (no created_tx).
const A = `0x${"7".padStart(40, "0")}`;
const B = `0x${"8".padStart(40, "0")}`;
const ADMIN = `0x${"ad".repeat(20)}`;
const RELAYER = `0x${"ee".repeat(20)}`;
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const NOW = new Date("2026-11-25T12:00:00Z");
const istDay = (iso: string) => Math.floor((Date.parse(iso) / 1000 + 19800) / 86400);

let pg: PGlite;
let db: Queryable;
let server: Server | undefined;
let url: string;

async function decision(bot: number): Promise<string> {
  const { rows: s } = await pg.query<{ id: string }>("insert into slots (slot_time, kind) values ($1, 'debut') returning id::text as id", ["2026-11-23T03:30:00Z"]);
  const { rows } = await pg.query<{ id: string }>(
    `insert into decisions (bot_id, version, slot_id, prompt_version, model, input_json, input_hash, status)
     values ($1, 1, $2, 'p', 'm', '{}', decode(repeat('00', 32), 'hex'), 'executed') returning id::text as id`,
    [bot, s[0]!.id],
  );
  return rows[0]!.id;
}

beforeEach(async () => {
  ({ pg, db } = await testDb());
  await pg.exec(`
    insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades) values
      (0, '2026-11-20T00:00:00Z', '2026-11-21T00:00:00Z', 'sprint', 8),
      (1, '2026-11-22T00:00:00Z', '2026-11-24T00:00:00Z', 'sprint', 8),
      (2, '2026-11-24T00:00:00Z', '2026-11-26T00:00:00Z', 'sprint', 8);
    update seasons set root_tx = '${tx(901)}', scores_tx = '${tx(902)}' where id = 1;
    -- User bots, indexed: A joined in S1, B long before any season.
    update bots set created_tx = '${tx(1)}', created_at = '2026-11-22T10:00:00Z' where id = 7;
    update bots set created_tx = '${tx(2)}', created_at = '2026-10-01T10:00:00Z' where id = 8;
    -- A house bot (admin key) with an admin-committed v2: system, never user.
    insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash, created_tx, is_house)
      values (9, '${ADMIN}', 'Steady Sam', 's', 'p', decode(repeat('00', 32), 'hex'), '${tx(903)}', true);
    insert into bot_versions (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source, committed_tx)
      values (9, 1, 'r', 2500, 4, '{}', decode(repeat('00', 32), 'hex'), 'create', '${tx(903)}'),
             (9, 2, 'r', 2500, 4, '{}', decode(repeat('00', 32), 'hex'), 'season_v2', '${tx(904)}');
    -- relay_log isn't read: a confirmed row naming the relayer must change nothing.
    insert into relay_log (user_wallet, status, tx_hash) values ('${RELAYER}', 'confirmed', '${tx(905)}');
  `);

  const d = await decision(7);
  // Runner batch (system) and an owner-approved Big Move (user) on bot 7.
  await pg.query(
    `insert into trades (decision_id, action_index, order_id, bot_id, asset, side, cash_e8, units_e18, price_e8, round_id, tx_hash, log_index, block_number)
     values ($1, 0, decode(repeat('aa', 32), 'hex'), 7, 'BTC', 'BUY', 1, 1, 1, 1, $2, 0, 9),
            ($1, 1, decode(repeat('bb', 32), 'hex'), 7, 'ETH', 'BUY', 1, 1, 1, 1, $3, 0, 10)`,
    [d, tx(906), tx(3)],
  );
  await pg.query(
    `insert into big_moves (decision_id, action_index, order_id, bot_id, asset, side, bps, runner_sig, deadline, status, user_tx, created_at)
     values ($1, 1, decode(repeat('bb', 32), 'hex'), 7, 'ETH', 'BUY', 4000, '\\x00', now(), 'approved', $2, '2026-11-23T03:30:00Z'),
            ($1, 2, decode(repeat('cc', 32), 'hex'), 7, 'ETH', 'BUY', 4000, '\\x00', now(), 'pending', null, '2026-11-23T03:30:00Z')`,
    [d, tx(3)],
  );
  // One indexed correction by A in S1, one still optimistic (no tx) that must not count.
  await pg.query(
    `insert into corrections (bot_id, decision_id, user_wallet, chip, tx_hash, created_at)
     values (7, $1, $2, 'too risky', $3, '2026-11-23T10:00:00Z'), (7, $1, $2, 'too timid', null, '2026-11-23T11:00:00Z')`,
    [d, A, tx(4)],
  );
  // A's Daily Call in S2, settled by the committer (system).
  await pg.query(
    `insert into daily_calls (bot_id, user_wallet, day, user_up, bot_up, bot_up_sig, call_tx, settle_tx)
     values (7, $1, $2, true, false, '\\x00', $3, $4)`,
    [A, istDay("2026-11-25T06:00:00Z"), tx(5), tx(907)],
  );
  // A challenges B; B accepts. No time stored.
  await pg.query("insert into challenges (code, season_id, challenger_bot, opponent_bot, create_tx, accept_tx, status) values ($1, 2, 7, 8, $2, $3, 'accepted')", [
    tx(77),
    tx(6),
    tx(7),
  ]);
}, 30_000);

afterEach(async () => {
  if (server) await new Promise<void>((done) => server!.close(() => done()));
  server = undefined;
  await pg.close();
});

describe("activityStats", () => {
  it("counts user-signed actions by the owner the contract checked, and system txs apart", async () => {
    const stats = await activityStats(db, NOW);
    expect(stats.userSigned).toEqual({
      txs: 7,
      signers: 2,
      active7d: 1, // A; B's only timed action is from October
      active30d: 1,
      recurring: 1, // A: S1 (createBot, correction) and S2 (daily call)
      byAction: {
        createBot: { txs: 2, wallets: 2 },
        approveV2: { txs: 0, wallets: 0 },
        correction: { txs: 1, wallets: 1 },
        bigMove: { txs: 1, wallets: 1 },
        dailyCall: { txs: 1, wallets: 1 },
        challengeCreate: { txs: 1, wallets: 1 },
        challengeAccept: { txs: 1, wallets: 1 },
      },
    });
    expect(stats.system).toEqual({
      txs: 6,
      byKind: { runnerTrades: 1, dailyCallSettles: 1, seasonCloses: 1, scoreCommits: 1, houseBots: 2 },
    });
  });

  it("never counts a system tx or a system key as a user", async () => {
    const stats = await activityStats(db, NOW);
    const userTxs = [1, 2, 3, 4, 5, 6, 7].map(tx);
    const systemTxs = [901, 902, 903, 904, 906, 907].map(tx);
    expect(userTxs.length).toBe(stats.userSigned.txs);
    expect(systemTxs.length).toBe(stats.system.txs);
    // More runner batches, settles and house-bot txs leave every user number as it was.
    const d = await decision(8);
    await pg.query(
      `insert into trades (decision_id, action_index, order_id, bot_id, asset, side, cash_e8, units_e18, price_e8, round_id, tx_hash, log_index, block_number)
       values ($1, 0, decode(repeat('dd', 32), 'hex'), 8, 'BTC', 'BUY', 1, 1, 1, 1, $2, 0, 11)`,
      [d, tx(908)],
    );
    await pg.query("update seasons set root_tx = $1 where id = 2", [tx(909)]);
    await pg.query("insert into relay_log (user_wallet, status, tx_hash) values ($1, 'confirmed', $2)", [RELAYER, tx(910)]);
    const after = await activityStats(db, NOW);
    expect(after.userSigned).toEqual(stats.userSigned);
    expect(after.system.txs).toBe(stats.system.txs + 2);
  });

  it("is all zeros on an empty database", async () => {
    await pg.exec("truncate bots, bot_versions, seasons, trades, big_moves, corrections, daily_calls, challenges, decisions, slots cascade");
    const stats = await activityStats(db, NOW);
    expect(stats.userSigned).toMatchObject({ txs: 0, signers: 0, active7d: 0, active30d: 0, recurring: 0 });
    expect(stats.system.txs).toBe(0);
  });
});

describe("GET /stats", () => {
  let clock = 0;
  async function start(over: Partial<StatsRouteOptions> = {}) {
    server = createWorkerServer({
      health: new HealthState({ provider: "fake", capUsd: null }),
      routes: statsRoutes({ db, origins: new Set(), clientIp: () => "1.2.3.4", now: () => NOW.getTime() + clock, ...over }),
    });
    await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/stats`;
  }

  it("serves the stats, cached for a minute", async () => {
    clock = 0;
    await start();
    const first = (await (await fetch(url)).json()) as { ok: true; stats: ActivityStats };
    expect(first.stats.userSigned.signers).toBe(2);
    expect(first.stats.asOf).toBe(NOW.toISOString());

    await pg.query("update bots set created_tx = null where id = 8");
    const cached = (await (await fetch(url)).json()) as { stats: ActivityStats };
    expect(cached.stats.userSigned.signers).toBe(2);
    clock = STATS_CACHE_MS;
    const fresh = (await (await fetch(url)).json()) as { stats: ActivityStats };
    expect(fresh.stats.userSigned.byAction.createBot.txs).toBe(1);
  });

  it("answers in the shape apps/web's fetchStats accepts", async () => {
    clock = 0;
    await start();
    const result = await fetchStats(url.replace(/\/stats$/, ""));
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.stats).toMatchObject({ asOf: NOW.toISOString(), userSigned: { txs: 7, signers: 2 }, system: { txs: 6 } });
  });

  it("503 when not configured, 429 when flooded", async () => {
    await start({ db: null });
    expect((await fetch(url)).status).toBe(503);
    await new Promise<void>((done) => server!.close(() => done()));

    await start();
    for (let i = 0; i < STATS_PER_IP_PER_MINUTE; i++) await fetch(url);
    const flooded = await fetch(url);
    expect(flooded.status).toBe(429);
    expect(flooded.headers.get("retry-after")).toBe("60");
  });
});
