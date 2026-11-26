import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { dailyCallBotViewTypedData, istDay } from "@botfolio/shared";
import { recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthenticator } from "../../src/auth/authenticator";
import { RelayJwt } from "../../src/auth/jwt";
import { DAILY_CALL_PATH, DAILY_CALL_VIEW_PATH, dailyCallRoutes } from "../../src/daily-call/route";
import { HealthState } from "../../src/health";
import type { Queryable } from "../../src/scheduler/db";
import { createWorkerServer } from "../../src/server";
import { signDailyCallView } from "../../src/signing";

const SCHEMA = readFileSync(new URL("../../../../packages/db/schema.sql", import.meta.url), "utf8");
const OWNER = `0x${"a1".repeat(20)}` as const;
const OTHER = `0x${"b2".repeat(20)}` as const;
const ORIGIN = "https://app.example";
const DAILY_CALL = `0x${"dc".repeat(20)}` as const;
const runner = privateKeyToAccount(`0x${"42".repeat(32)}`);
const jwt = new RelayJwt("test-only-secret-".padEnd(40, "x"));
const ZERO = `\\x${"00".repeat(32)}`;
const at = (ist: string) => new Date(`${ist}+05:30`);
const NINE = at("2026-11-25T09:00:00");
const DAY = istDay(Math.floor(NINE.getTime() / 1000));

let pg: PGlite;
let server: Server;
let base: string;
let clock: Date;
const log = vi.fn();

async function bot(id: number, owner: string, name: string, opts: { house?: boolean } = {}) {
  await pg.query("insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash, is_house) values ($1, $2, $3, 'b', 'p', $4, $5)", [
    id,
    owner,
    name,
    ZERO,
    opts.house ?? false,
  ]);
  await pg.query(
    `insert into bot_versions (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source)
     values ($1, 1, 'r', 2500, 4, '{}', $2, 'create')`,
    [id, ZERO],
  );
}

/** A decision for the bot at `time` (a 09:00 slot, or a debut). */
async function decided(botId: number, time: Date, kind: "scheduled" | "debut" = "scheduled") {
  const { rows } = await pg.query<{ id: string }>("insert into slots (slot_time, kind) values ($1, $2) returning id::text as id", [time, kind]);
  await pg.query(
    `insert into decisions (bot_id, version, slot_id, prompt_version, model, input_json, input_hash, status)
     values ($1, 1, $2, 'p', 'm', '{}', $3, 'executed')`,
    [botId, rows[0]!.id, ZERO],
  );
}

/** The view as the runner writes it (src/slot/signed.ts). */
async function view(botId: number, decidedAt: Date, btcUp: boolean) {
  const signed = await signDailyCallView(runner, DAILY_CALL, { botId: BigInt(botId), decidedAt, btcUp });
  await pg.query("insert into daily_calls (bot_id, day, bot_up, bot_up_sig) values ($1, $2, $3, decode($4, 'hex'))", [
    botId,
    signed.day,
    signed.botUp,
    signed.botSig.slice(2),
  ]);
}

async function call(path: string, body: unknown, wallet: string | null = OWNER) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN };
  if (wallet) Object.assign(headers, { authorization: `Bearer ${(await jwt.sign(wallet as Hex)).token}`, "x-botfolio-auth": "siwe" });
  const res = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const states = async () =>
  Object.fromEntries(((await call(DAILY_CALL_PATH, {})).body.bots as { botId: string; state: string }[]).map((b) => [b.botId, b.state]));

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
  const db = { query: async <Row>(sql: string, params?: unknown[]) => ({ rows: (await pg.query<Row>(sql, params)).rows }) } as Queryable;
  await bot(7, OWNER, "AlphaWolf");
  await bot(8, OTHER, "Someone Else");
  clock = at("2026-11-25T10:00:00");
  server = createWorkerServer({
    health: new HealthState({ provider: "fake", capUsd: null }),
    routes: dailyCallRoutes({ origins: new Set([ORIGIN]), auth: createAuthenticator({ jwt, privy: null }), log, db, now: () => clock }),
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  log.mockClear();
}, 30_000);

afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await pg.close();
});

describe("POST /daily-call", () => {
  it("lists only the owner's active non-house bots, with the day and the 20:00 cutoff", async () => {
    await bot(9, OWNER, "House", { house: true });
    await bot(10, OWNER, "Paused");
    await pg.query("update bots set status = 'paused' where id = 10");
    const res = await call(DAILY_CALL_PATH, {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, day: DAY, closesAt: at("2026-11-25T20:00:00").toISOString() });
    expect(res.body.bots).toEqual([{ botId: "7", botName: "AlphaWolf", state: "waiting" }]);
  });

  it("a bot with a view is open until 20:00, then closed", async () => {
    await decided(7, NINE);
    await view(7, NINE, true);
    expect(await states()).toEqual({ "7": "open" });
    clock = at("2026-11-25T19:59:59");
    expect(await states()).toEqual({ "7": "open" });
    clock = at("2026-11-25T20:00:00");
    expect(await states()).toEqual({ "7": "closed" });
  });

  it("never carries the bot's view", async () => {
    await decided(7, NINE);
    await view(7, NINE, true);
    const up = JSON.stringify((await call(DAILY_CALL_PATH, {})).body);
    expect(up).not.toMatch(/botUp|bot_up|botSig/);
    await pg.query("update daily_calls set bot_up = false where bot_id = 7");
    expect(JSON.stringify((await call(DAILY_CALL_PATH, {})).body)).toBe(up);
  });

  it("a bot created after 09:00 whose debut gave a view can play today", async () => {
    const debut = at("2026-11-25T09:47:00");
    await decided(7, debut, "debut");
    await view(7, debut, false);
    expect(await states()).toEqual({ "7": "open" });
  });

  it("a bot that decided since 09:00 without a view joins tomorrow's call", async () => {
    await decided(7, at("2026-11-25T09:47:00"), "debut"); // e.g. the model left daily_call out
    expect(await states()).toEqual({ "7": "joins_tomorrow" });
  });

  it("waits, not joins tomorrow, while the bot's 09:00 or debut decision hasn't run", async () => {
    clock = at("2026-11-25T08:30:00");
    await decided(7, at("2026-11-24T21:00:00")); // yesterday's decisions don't count
    expect(await states()).toEqual({ "7": "waiting" });
    clock = at("2026-11-25T09:01:00");
    expect(await states()).toEqual({ "7": "waiting" });
  });

  it("yesterday's view doesn't open today", async () => {
    const yesterday = at("2026-11-24T09:00:00");
    await decided(7, yesterday);
    await view(7, yesterday, true);
    await decided(7, NINE);
    expect(await states()).toEqual({ "7": "joins_tomorrow" });
  });

  it("called once the owner's call is indexed", async () => {
    await decided(7, NINE);
    await view(7, NINE, true);
    await pg.query("update daily_calls set user_wallet = $1, user_up = false where bot_id = 7", [OWNER]);
    expect(await states()).toEqual({ "7": "called" });
  });

  it("needs a sign-in", async () => {
    expect((await call(DAILY_CALL_PATH, {}, null)).status).toBe(401);
  });
});

describe("POST /daily-call/view", () => {
  it("serves the runner-signed view, which recovers to the runner", async () => {
    await decided(7, NINE);
    await view(7, NINE, true);
    const res = await call(DAILY_CALL_VIEW_PATH, { botId: "7", userUp: true });
    expect(res.status).toBe(200);
    const served = res.body.view as { botId: string; day: number; botUp: boolean; botSig: Hex };
    expect(served).toMatchObject({ botId: "7", day: DAY, botUp: true });
    const signer = await recoverTypedDataAddress({
      ...dailyCallBotViewTypedData(DAILY_CALL, { botId: 7n, day: served.day, botUp: served.botUp }),
      signature: served.botSig,
    });
    expect(signer).toBe(runner.address);
    // #254: the view stays out of the logs.
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/botUp|botSig/);
  });

  it("a late bot's debut view is served the same way", async () => {
    const debut = at("2026-11-25T14:10:00");
    clock = at("2026-11-25T14:11:00");
    await decided(7, debut, "debut");
    await view(7, debut, false);
    const res = await call(DAILY_CALL_VIEW_PATH, { botId: 7, userUp: false });
    expect(res.status).toBe(200);
    expect(res.body.view).toMatchObject({ botId: "7", day: DAY, botUp: false });
  });

  it("refuses with the state the app shows", async () => {
    await decided(7, NINE);
    expect((await call(DAILY_CALL_VIEW_PATH, { botId: "7", userUp: true })).body).toMatchObject({
      error: { code: "JOINS_TOMORROW", message: "Your bot joins tomorrow's call." },
    });
    await view(7, NINE, true);
    clock = at("2026-11-25T20:00:00");
    expect((await call(DAILY_CALL_VIEW_PATH, { botId: "7", userUp: true })).body).toMatchObject({ error: { code: "CLOSED" } });
    clock = at("2026-11-25T12:00:00");
    await pg.query("update daily_calls set user_wallet = $1, user_up = false where bot_id = 7", [OWNER]);
    const res = await call(DAILY_CALL_VIEW_PATH, { botId: "7", userUp: true });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: "ALREADY_CALLED" } });
  });

  it("someone else's bot is not found, and the botId is checked", async () => {
    await decided(8, NINE);
    await view(8, NINE, true);
    expect((await call(DAILY_CALL_VIEW_PATH, { botId: "8", userUp: true })).status).toBe(404);
    for (const botId of [undefined, "abc", "0", -1, 1.5, "0x07"]) {
      expect((await call(DAILY_CALL_VIEW_PATH, { botId })).status).toBe(400);
    }
    expect((await call(DAILY_CALL_VIEW_PATH, { botId: "7", userUp: true }, null)).status).toBe(401);
  });

  it("serves the view only for a pick, stores the pick first, and never lets it change (#219 item 21)", async () => {
    await decided(7, NINE);
    await view(7, NINE, false);
    for (const userUp of [undefined, "true", 1, null]) {
      const res = await call(DAILY_CALL_VIEW_PATH, { botId: "7", userUp });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(/botUp|botSig/);
    }
    const pick = async () => (await pg.query<{ up: boolean | null }>("select user_up as up from daily_calls where bot_id = 7")).rows[0]!.up;
    expect(await pick()).toBeNull();

    expect((await call(DAILY_CALL_VIEW_PATH, { botId: "7", userUp: true })).status).toBe(200);
    expect(await pick()).toBe(true);
    // Asking again with the same pick (say the relay failed) is fine; the other way is not.
    expect((await call(DAILY_CALL_VIEW_PATH, { botId: "7", userUp: true })).status).toBe(200);
    const flipped = await call(DAILY_CALL_VIEW_PATH, { botId: "7", userUp: false });
    expect(flipped.status).toBe(409);
    expect(flipped.body).toMatchObject({ error: { code: "PICK_LOCKED" } });
    expect(JSON.stringify(flipped.body)).not.toMatch(/botUp|botSig/);
    expect(await pick()).toBe(true);
  });
});
