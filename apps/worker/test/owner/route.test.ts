import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { PGlite } from "@electric-sql/pglite";
import { istDay } from "@botfolio/shared";
import type { Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthenticator } from "../../src/auth/authenticator";
import { RelayJwt } from "../../src/auth/jwt";
import { CHALLENGE_PATH, challengeRoutes } from "../../src/challenges/route";
import { HealthState } from "../../src/health";
import { OWNER_PATH, ownerRoutes } from "../../src/owner/route";
import type { Queryable } from "../../src/scheduler/db";
import { createWorkerServer } from "../../src/server";
import { testDb } from "../decisions/helpers";
import { parseChallenge, parseOwner } from "../../../web/lib/owner";

const ORIGIN = "https://app.example";
const OWNER = `0x${"7".padStart(40, "0")}` as Hex; // bot 7's owner in testDb
const jwt = new RelayJwt("test-only-secret-".padEnd(40, "x"));
const at = (ist: string) => new Date(`${ist}+05:30`);
const TX = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const H = `\\x${"ab".repeat(32)}`;

let pg: PGlite;
let db: Queryable;
let server: Server;
let base: string;
let clock: Date;

async function start(over: { db?: Queryable | null } = {}) {
  const d = "db" in over ? over.db! : db;
  server = createWorkerServer({
    health: new HealthState({ provider: "fake", capUsd: null }),
    routes: {
      ...ownerRoutes({ origins: new Set([ORIGIN]), auth: createAuthenticator({ jwt, privy: null }), log: vi.fn(), db: d, now: () => clock }),
      ...challengeRoutes({ db: d, origins: new Set([ORIGIN]), clientIp: () => "1.2.3.4" }),
    },
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function owner(wallet: string | null = OWNER) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN };
  if (wallet) Object.assign(headers, { authorization: `Bearer ${(await jwt.sign(wallet as Hex)).token}`, "x-botfolio-auth": "siwe" });
  const res = await fetch(base + OWNER_PATH, { method: "POST", headers, body: "{}" });
  return { status: res.status, body: (await res.json()) as { ok: boolean; bots: Record<string, unknown>[] } };
}

const call = (day: number, o: { user: boolean; bot: boolean; settled?: boolean; userOk?: boolean; botOk?: boolean }) =>
  pg.query(
    `insert into daily_calls (bot_id, user_wallet, day, user_up, bot_up, bot_up_sig, price_at_call_e8, call_tx, settle_tx, user_correct, bot_correct)
     values (7, $1, $2, $3, $4, '\\x00', 9000000000000, $5, $6, $7, $8)`,
    [OWNER, day, o.user, o.bot, TX(day), o.settled ? TX(day + 1000) : null, o.settled ? (o.userOk ?? null) : null, o.settled ? (o.botOk ?? null) : null],
  );

beforeEach(async () => {
  ({ pg, db } = await testDb());
  clock = at("2026-11-26T10:00:00");
  await pg.query(
    `insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades) values
       (1, $1, $2, 'sprint', 8), (2, $2, $3, 'sprint', 8)`,
    [at("2026-11-22T09:00:00"), at("2026-11-24T21:30:00"), at("2026-11-26T21:30:00")],
  );
});

afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await pg.close();
});

describe("POST /owner", () => {
  it("needs a sign-in and a database", async () => {
    await start();
    expect((await owner(null)).status).toBe(401);
    server.close();
    await start({ db: null });
    expect((await owner()).status).toBe(503);
  });

  it("lists only the caller's raised bots, with no proposal and no calls yet", async () => {
    await start();
    const res = await owner();
    expect(res.status).toBe(200);
    expect(res.body.bots).toEqual([
      { botId: "7", name: "B", status: "active", proposal: null, calls: { season: 2, you: 0, bot: 0, streak: 0, today: null } },
    ]);
  });

  it("serves the unapproved next version until approve_by, and never a committed or stale one", async () => {
    const config = { bot_id: "7", version: 2, season: 1, max_per_coin_bps: 2000, max_trades_per_day: 4, approve_by: at("2026-11-26T08:30:00").toISOString() };
    await pg.query(
      `insert into bot_versions (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source)
       values (7, 2, 'r2', 2000, 4, $1, $2, 'season_v2')`,
      [JSON.stringify(config), H],
    );
    clock = at("2026-11-26T08:00:00");
    await start();
    const [bot] = (await owner()).body.bots;
    expect(bot!.proposal).toEqual({ version: 2, configHash: `0x${"ab".repeat(32)}`, config, approveBy: config.approve_by });

    clock = at("2026-11-26T08:30:00"); // the window closed: the bot keeps v1
    expect((await owner()).body.bots[0]!.proposal).toBeNull();

    clock = at("2026-11-26T08:00:00");
    await pg.query(`update bot_versions set committed_tx = $1 where bot_id = 7 and version = 2`, [TX(9)]);
    expect((await owner()).body.bots[0]!.proposal).toBeNull();
  });

  it("scores this season's settled calls, counts the current streak and shows today's call", async () => {
    const today = istDay(Math.floor(clock.getTime() / 1000));
    await call(today - 5, { user: true, bot: true, settled: true, userOk: true, botOk: true }); // season 1, not counted
    await call(today - 2, { user: true, bot: false, settled: true, userOk: false, botOk: true });
    await call(today - 1, { user: true, bot: false, settled: true, userOk: true, botOk: false });
    await call(today, { user: false, bot: true });
    await start();
    const res = await owner();
    expect(parseOwner(res.body)).not.toBeNull();
    const { calls } = res.body.bots[0] as { calls: Record<string, unknown> };
    expect(calls).toEqual({
      season: 2,
      you: 1,
      bot: 1,
      streak: 1,
      today: { userUp: false, botUp: true, priceAtCallE8: "9000000000000", callTx: TX(today), settleTx: null, userCorrect: null, botCorrect: null },
    });
  });
});

describe("GET /challenge", () => {
  const CODE = `0x${"c0de".repeat(16)}`;

  it("resolves a short code to the full code and both sides", async () => {
    await pg.query(`insert into challenges (code, season_id, challenger_bot, opponent_bot, create_tx, status) values ($1, 2, 7, 8, $2, 'accepted')`, [CODE, TX(1)]);
    await start();
    const res = await fetch(`${base}${CHALLENGE_PATH}?code=${CODE.slice(2, 18)}`, { headers: { origin: ORIGIN } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(parseChallenge(body)).not.toBeNull(); // the app reads exactly this
    expect(body).toEqual({
      ok: true,
      challenge: {
        code: CODE,
        season: 2,
        status: "accepted",
        challenger: { botId: "7", name: "B", emoji: "b", ownerWallet: OWNER },
        opponent: { botId: "8", name: "B", emoji: "b", ownerWallet: `0x${"8".padStart(40, "0")}` },
        createTx: TX(1),
        acceptTx: null,
        winnerBotId: null,
      },
    });
  });

  it("refuses a malformed code and 404s an unknown one", async () => {
    await start();
    expect((await fetch(`${base}${CHALLENGE_PATH}?code=nothex`)).status).toBe(400);
    expect((await fetch(`${base}${CHALLENGE_PATH}?code=${"1".repeat(16)}`)).status).toBe(404);
  });
});
