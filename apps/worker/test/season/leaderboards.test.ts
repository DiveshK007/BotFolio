import type { PGlite } from "@electric-sql/pglite";
import { istDay } from "@botfolio/shared";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HealthState } from "../../src/health";
import type { Queryable } from "../../src/scheduler/db";
import { leaderboards } from "../../src/season/leaderboards";
import { LEADERBOARDS_CACHE_MS, leaderboardRoutes } from "../../src/season/route";
import { createWorkerServer } from "../../src/server";
import { testDb } from "../decisions/helpers";

const E8 = 100_000_000n;
const START = 1000n * E8;
const ist = (time: string) => new Date(`${time}+05:30`);
const startCash = async () => START;

let pg: PGlite;
let db: Queryable;

beforeEach(async () => {
  ({ pg, db } = await testDb()); // bots 7 and 8
  await pg.exec(`
    insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash, is_house)
    values (90, '0x${"9".repeat(40)}', 'Steady Sam', 's', '', decode(repeat('00', 32), 'hex'), true);
    update bots set created_at = '2026-11-20T00:00:00Z' where id = 90;
    update bots set created_at = '2026-11-21T00:00:00Z' where id = 7;
    update bots set created_at = '2026-11-22T00:00:00Z' where id = 8;
    insert into qie_names (wallet_address, qie_name) values ('0x${"7".padStart(40, "0")}', 'alice.qie');`);
  await pg.query(
    "insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades, status) values (1, $1, $2, 'sprint', 8, 'closed'), (2, $3, $4, 'sprint', 8, 'open')",
    [ist("2026-11-26T00:00:00"), ist("2026-11-28T21:30:00"), ist("2026-11-29T00:00:00"), ist("2026-11-30T21:30:00")],
  );
}, 30_000);
afterEach(() => pg.close());

async function result(botId: number, returnBps: number, maxDdBps: number, sortino: number | null) {
  await pg.query(
    "insert into season_results (season_id, bot_id, start_value_e8, end_value_e8, return_bps, sortino, max_dd_bps, trades) values (1, $1, 1, 1, $2, $3, $4, 3)",
    [botId, returnBps, sortino, maxDdBps],
  );
}
async function trust(season: number, botId: number, total: number, provisional = false) {
  const f = Math.floor(total / 4);
  await pg.query(
    `insert into trust_scores (season_id, bot_id, rules_version, f_rules, f_drawdown, f_consistency, f_explains, total, provisional, leaf_hash)
     values ($1, $2, 'trust-v1-sprint', $3, $3, $3, $4, $5, $6, decode(repeat('00', 32), 'hex'))`,
    [season, botId, f, total - 3 * f, total, provisional],
  );
}
let callTx = 0;
async function call(botId: number, time: string, user: boolean | null, bot: boolean | null, called = true) {
  callTx++;
  await pg.query(
    `insert into daily_calls (bot_id, day, user_up, bot_up, bot_up_sig, user_correct, bot_correct, call_tx)
     values ($1, $2, true, true, '\\x00', $3, $4, $5)`,
    [botId, istDay(ist(time).getTime() / 1000), user, bot, called ? `0x${callTx.toString(16).padStart(64, "0")}` : null],
  );
}

async function seedClosedSeason() {
  await result(7, 500, 300, 1.5);
  await result(8, 500, 200, null); // too few trades or days for Sortino
  await result(90, 900, 100, 2);
  await trust(1, 7, 800);
  await trust(1, 8, 900, true); // provisional: off the board
  await trust(1, 90, 700);
  // Bot 7: 2 calls with a result (you 1, bot 1), one equal price (no result), one before the season.
  await call(7, "2026-11-26T10:00:00", true, false);
  await call(7, "2026-11-27T10:00:00", false, true);
  await call(7, "2026-11-28T10:00:00", null, null);
  await call(7, "2026-11-25T10:00:00", true, true);
  // Bot 8: 2 of 2, and one the owner never made.
  await call(8, "2026-11-26T10:00:00", true, false);
  await call(8, "2026-11-27T10:00:00", true, true);
  await call(8, "2026-11-28T10:00:00", true, true, false);
}

describe("leaderboards (SPEC §8)", () => {
  it("ranks a closed season from what its close stored", async () => {
    await seedClosedSeason();
    const boards = (await leaderboards(db, 1, startCash))!;
    expect(boards).toMatchObject({ season: 1, live: false, trustSeason: 1 });

    const pick = (entries: { botId: string; rank: number | null }[]) => entries.map((e) => [e.botId, e.rank]);
    // The house bot is listed but never ranked; 8 beats 7 on the lower drawdown.
    expect(pick(boards.topReturns)).toEqual([["90", null], ["8", 1], ["7", 2]]);
    expect(pick(boards.bestRiskAdjusted)).toEqual([["90", null], ["7", 1]]);
    expect(pick(boards.mostTrusted)).toEqual([["7", 1], ["90", null]]);
    expect(boards.topReturns[2]).toMatchObject({ name: "B", isHouse: false, ownerQieName: "alice.qie", returnBps: 500, maxDdBps: 300 });
    expect(boards.topReturns[0]).toMatchObject({ name: "Steady Sam", isHouse: true });
  });

  it("Coach vs Bot: win rate of the owner's calls with a result, at least 2 in a sprint season", async () => {
    await seedClosedSeason();
    const boards = (await leaderboards(db, 1, startCash))!;
    expect(boards.coachVsBot.map((e) => [e.botId, e.calls, e.you, e.bot, e.rank])).toEqual([
      ["8", 2, 2, 1, 1],
      ["7", 2, 1, 1, 2],
    ]);
    await pg.query("update seasons set kind = 'weekly' where id = 1");
    expect((await leaderboards(db, 1, startCash))!.coachVsBot).toEqual([]);
  });

  it("breaks an exact tie by the bot created first", async () => {
    await result(7, 100, 100, null);
    await result(8, 100, 100, null);
    expect((await leaderboards(db, 1, startCash))!.topReturns.map((e) => e.botId)).toEqual(["7", "8"]);
    await pg.query("update bots set created_at = '2026-11-19T00:00:00Z' where id = 8");
    expect((await leaderboards(db, 1, startCash))!.topReturns.map((e) => e.botId)).toEqual(["8", "7"]);
  });

  it("an open season is live from its marks, with the latest scored season's trust", async () => {
    await trust(1, 7, 800);
    for (const [time, value] of [["2026-11-29T09:00:00", 1100n], ["2026-11-29T21:00:00", 1050n]] as const) {
      await pg.query("insert into slots (slot_time, kind, season_id) values ($1, 'scheduled', 2)", [ist(time)]);
      const { rows } = await pg.query<{ id: string }>("select id::text as id from slots where slot_time = $1", [ist(time)]);
      await pg.query("insert into portfolio_marks (bot_id, slot_id, cash_e8, holdings, value_e8) values (7, $1, 0, '{}', $2)", [rows[0]!.id, (value * E8).toString()]);
    }
    const boards = (await leaderboards(db, 2, startCash))!;
    expect(boards).toMatchObject({ season: 2, live: true, trustSeason: 1 });
    expect(boards.topReturns).toEqual([expect.objectContaining({ botId: "7", returnBps: 500, maxDdBps: 454, rank: 1 })]);
    expect(boards.mostTrusted.map((e) => e.botId)).toEqual(["7"]);
  });

  it("is null for a season that doesn't exist", async () => {
    expect(await leaderboards(db, 9, startCash)).toBeNull();
  });
});

describe("GET /leaderboards", () => {
  let server: Server;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  async function start(options: Parameters<typeof leaderboardRoutes>[0]) {
    server = createWorkerServer({ health: new HealthState({ provider: "fake", capUsd: null }), routes: leaderboardRoutes(options) });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/leaderboards`;
  }

  it("serves the boards, caches them for a minute, and refuses bad requests", async () => {
    await seedClosedSeason();
    let clock = 0;
    const url = await start({ source: { db, startCashE8: startCash }, origins: new Set(), clientIp: () => "1.2.3.4", now: () => clock });

    const first = (await (await fetch(`${url}?season=1`)).json()) as { ok: boolean; leaderboards: { topReturns: { botId: string }[] } };
    expect(first.leaderboards.topReturns.map((e) => e.botId)).toEqual(["90", "8", "7"]);

    await pg.query("update season_results set return_bps = 9999 where bot_id = 7");
    const cached = (await (await fetch(`${url}?season=1`)).json()) as typeof first;
    expect(cached.leaderboards.topReturns[0]!.botId).toBe("90");
    clock += LEADERBOARDS_CACHE_MS;
    const fresh = (await (await fetch(`${url}?season=1`)).json()) as typeof first;
    expect(fresh.leaderboards.topReturns[0]!.botId).toBe("7");

    expect((await fetch(`${url}?season=9`)).status).toBe(404);
    for (const q of ["", "?season=x", "?season=01", "?season=-1"]) expect((await fetch(`${url}${q}`)).status).toBe(400);
  });

  it("is 503 when not configured", async () => {
    const url = await start({ source: null, origins: new Set(), clientIp: () => "1.2.3.4" });
    expect((await fetch(`${url}?season=1`)).status).toBe(503);
  });
});
