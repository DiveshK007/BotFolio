import type { PGlite } from "@electric-sql/pglite";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HealthState } from "../../src/health";
import type { Queryable } from "../../src/scheduler/db";
import { createWorkerServer } from "../../src/server";
import { BOTS_CACHE_MS, BOTS_PER_IP_PER_MINUTE, botsRoutes, listBots, type BotsRouteOptions } from "../../src/bots/route";
import { testDb } from "../decisions/helpers";

const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
let pg: PGlite;
let db: Queryable;
let server: Server | undefined;
let url: string;

// testDb: bots 7 and 8, both optimistic (no created_tx), each with an uncommitted v1.
beforeEach(async () => {
  ({ pg, db } = await testDb());
  await pg.exec(`
    update bots set created_tx = '${tx(1)}', created_at = '2026-11-22T10:00:00Z', name = 'AlphaWolf' where id = 7;
    update bot_versions set committed_tx = '${tx(1)}' where bot_id = 7;
    insert into bot_versions (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source, committed_tx)
      values (7, 2, 'r', 2500, 4, '{}', decode(repeat('00', 32), 'hex'), 'season_v2', '${tx(2)}'),
             (7, 3, 'r', 2500, 4, '{}', decode(repeat('00', 32), 'hex'), 'season_v2', null);
    insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash, created_tx, is_house, created_at)
      values (9, '0x${"ad".repeat(20)}', 'Steady Sam', 's', 'p', decode(repeat('00', 32), 'hex'), '${tx(3)}', true, '2026-11-21T00:00:00Z'),
             (10, '0x${"0a".repeat(20)}', 'Banned', 'x', 'p', decode(repeat('00', 32), 'hex'), '${tx(4)}', false, '2026-11-23T00:00:00Z');
    update bots set status = 'banned' where id = 10;
  `);
});
afterEach(async () => {
  if (server) await new Promise<void>((done) => server!.close(() => done()));
  server = undefined;
  await pg.close();
});

describe("listBots", () => {
  it("lists indexed, unbanned bots newest first with their committed version", async () => {
    expect(await listBots(db)).toEqual([
      { botId: "7", name: "AlphaWolf", emoji: "b", isHouse: false, version: 2, createdAt: "2026-11-22T10:00:00.000Z" },
      { botId: "9", name: "Steady Sam", emoji: "s", isHouse: true, version: 1, createdAt: "2026-11-21T00:00:00.000Z" },
    ]);
  });
});

describe("GET /bots", () => {
  let clock = 0;
  async function start(over: Partial<BotsRouteOptions> = {}) {
    server = createWorkerServer({
      health: new HealthState({ provider: "fake", capUsd: null }),
      routes: botsRoutes({ db, origins: new Set(), clientIp: () => "1.2.3.4", now: () => clock, ...over }),
    });
    await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("answers in the shape apps/web's fetchBots accepts, cached for a minute", async () => {
    clock = 0;
    await start();
    const get = async () => ((await (await fetch(url + "/bots")).json()) as { ok: true; bots: { botId: string }[] }).bots;
    expect((await get()).map((b) => b.botId)).toEqual(["7", "9"]);
    await pg.query("update bots set created_tx = null where id = 9");
    expect(await get()).toHaveLength(2);
    clock = BOTS_CACHE_MS;
    expect(await get()).toHaveLength(1);
  });

  it("503 when not configured, 429 when flooded", async () => {
    await start({ db: null });
    expect((await fetch(url + "/bots")).status).toBe(503);
    await new Promise<void>((done) => server!.close(() => done()));
    await start();
    for (let i = 0; i < BOTS_PER_IP_PER_MINUTE; i++) await fetch(url + "/bots");
    expect((await fetch(url + "/bots")).status).toBe(429);
  });
});
