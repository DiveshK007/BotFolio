import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { approvedOrderFromJson, approvedOrderTypedData, decisionIdFromUuid, orderIdOf } from "@botfolio/shared";
import { recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthenticator } from "../../src/auth/authenticator";
import { RelayJwt } from "../../src/auth/jwt";
import { BIG_MOVES_PATH, BIG_MOVES_SHRINK_PATH, bigMoveRoutes } from "../../src/big-moves/route";
import { HealthState } from "../../src/health";
import type { Queryable } from "../../src/scheduler/db";
import { createWorkerServer } from "../../src/server";
import { signApprovedOrder } from "../../src/signing";

const SCHEMA = readFileSync(new URL("../../../../packages/db/schema.sql", import.meta.url), "utf8");
const OWNER = `0x${"a1".repeat(20)}` as const;
const OTHER = `0x${"b2".repeat(20)}` as const;
const ORIGIN = "https://app.example";
const LEDGER = `0x${"1e".repeat(20)}` as const;
const runner = privateKeyToAccount(`0x${"42".repeat(32)}`);
const jwt = new RelayJwt("test-only-secret-".padEnd(40, "x"));
const ZERO = `\\x${"00".repeat(32)}`;

let pg: PGlite;
let db: Queryable;
let server: Server;
let base: string;
const log = vi.fn();

async function bot(id: number, owner: string, name: string) {
  await pg.query("insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash) values ($1, $2, $3, 'b', 'p', $4)", [id, owner, name, ZERO]);
  await pg.query(
    `insert into bot_versions (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source)
     values ($1, 1, 'r', 2500, 4, '{}', $2, 'create')`,
    [id, ZERO],
  );
}

/** A pending big move signed the way the runner signs it. Returns its orderId. */
async function bigMove(botId: number, opts: { deadline?: Date; actionIndex?: number; wrongKey?: boolean; season?: number } = {}): Promise<Hex> {
  const { rows: slot } = await pg.query<{ id: string }>(
    "insert into slots (slot_time, kind, season_id) values (now(), 'scheduled', $1) returning id::text as id",
    [opts.season ?? null],
  );
  const { rows: d } = await pg.query<{ id: string }>(
    `insert into decisions (bot_id, version, slot_id, prompt_version, model, input_json, input_hash, reason, status)
     values ($1, 1, $2, 'p', 'm', '{}', $3, 'Gold looks great, going big.', 'executed') returning id::text as id`,
    [botId, slot[0]!.id, ZERO],
  );
  const actionIndex = opts.actionIndex ?? 0;
  const deadline = opts.deadline ?? new Date(Date.now() + 2 * 3_600_000);
  const order = {
    botId: BigInt(botId),
    asset: 4,
    buy: true,
    bps: 3500,
    decisionId: decisionIdFromUuid(d[0]!.id),
    actionIndex,
    deadline: BigInt(Math.floor(deadline.getTime() / 1000)),
  };
  const orderId = opts.wrongKey ? (`0x${"ee".repeat(32)}` as Hex) : orderIdOf(order.decisionId, actionIndex);
  const sig = await signApprovedOrder(runner, LEDGER, order);
  await pg.query(
    `insert into big_moves (decision_id, action_index, order_id, bot_id, asset, side, bps, runner_sig, deadline)
     values ($1, $2, decode($3, 'hex'), $4, 'GOLD', 'BUY', 3500, decode($5, 'hex'), to_timestamp($6))`,
    [d[0]!.id, actionIndex, orderId.slice(2), botId, sig.slice(2), Number(order.deadline)],
  );
  return orderId;
}

async function call(path: string, body: unknown, wallet: string | null = OWNER) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN };
  if (wallet) Object.assign(headers, { authorization: `Bearer ${(await jwt.sign(wallet as Hex)).token}`, "x-botfolio-auth": "siwe" });
  const res = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
  db = { query: async <Row>(sql: string, params?: unknown[]) => ({ rows: (await pg.query<Row>(sql, params)).rows }) } as Queryable;
  await bot(7, OWNER, "AlphaWolf");
  await bot(8, OTHER, "Someone Else");
  server = createWorkerServer({
    health: new HealthState({ provider: "fake", capUsd: null }),
    routes: bigMoveRoutes({ origins: new Set([ORIGIN]), auth: createAuthenticator({ jwt, privy: null }), log, db }),
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  log.mockClear();
}, 30_000);
afterEach(async () => {
  await new Promise((done) => server.close(done));
  await pg.close();
});

describe("POST /big-moves (#52)", () => {
  it("gives the owner their pending big moves with an order the runner's signature covers", async () => {
    const mine = await bigMove(7);
    await bigMove(8); // someone else's
    await bigMove(7, { deadline: new Date(Date.now() - 60_000) }); // past its window

    const { status, body } = await call(BIG_MOVES_PATH, {});
    expect(status).toBe(200);
    const moves = body.bigMoves as { orderId: Hex; botName: string; asset: string; side: string; bps: number; reason: string; signed: { order: never; runnerSig: Hex } }[];
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ orderId: mine, botName: "AlphaWolf", asset: "GOLD", side: "BUY", bps: 3500, reason: "Gold looks great, going big." });

    // The app relays executeApproved(order, runnerSig): the signature must recover to the runner for this order.
    const order = approvedOrderFromJson(moves[0]!.signed.order);
    expect(order).toMatchObject({ botId: 7n, asset: 4, buy: true, bps: 3500, actionIndex: 0 });
    expect(orderIdOf(order.decisionId, order.actionIndex)).toBe(mine);
    const signer = await recoverTypedDataAddress({ ...approvedOrderTypedData(LEDGER, order), signature: moves[0]!.signed.runnerSig });
    expect(signer).toBe(runner.address);
  });

  it("never serves a row whose key doesn't match its order, and needs a sign-in", async () => {
    await bigMove(7, { wrongKey: true });
    expect((await call(BIG_MOVES_PATH, {})).body.bigMoves).toEqual([]);
    expect(log).toHaveBeenCalledWith("big_moves.order_mismatch", expect.anything());
    expect((await call(BIG_MOVES_PATH, {}, null)).status).toBe(401);
  });

  it("stops serving a big move once its season has ended, and won't shrink it (#355)", async () => {
    await pg.exec(`insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades) values
      (0, now() - interval '2 days', now() - interval '1 minute', 'sprint', 8),
      (1, now() - interval '1 hour', now() + interval '1 day', 'sprint', 8)`);
    const ended = await bigMove(7, { season: 0 });
    const open = await bigMove(7, { season: 1 });
    const moves = (await call(BIG_MOVES_PATH, {})).body.bigMoves as { orderId: Hex }[];
    expect(moves.map((m) => m.orderId)).toEqual([open]);
    expect((await call(BIG_MOVES_SHRINK_PATH, { orderId: ended })).status).toBe(404);
  });
});

describe("POST /big-moves/shrink (#52)", () => {
  it("ends the owner's window now, so the next sweep sends the safe size", async () => {
    const mine = await bigMove(7);
    const { status } = await call(BIG_MOVES_SHRINK_PATH, { orderId: mine });
    expect(status).toBe(200);
    const { rows } = await pg.query<{ due: boolean; status: string }>("select deadline < now() as due, status::text as status from big_moves");
    expect(rows[0]).toEqual({ due: true, status: "pending" });
    expect((await call(BIG_MOVES_PATH, {})).body.bigMoves).toEqual([]);
    // Again: nothing is waiting any more.
    expect((await call(BIG_MOVES_SHRINK_PATH, { orderId: mine })).status).toBe(404);
  });

  it("can't shrink someone else's, and checks the id", async () => {
    const theirs = await bigMove(8);
    expect((await call(BIG_MOVES_SHRINK_PATH, { orderId: theirs })).status).toBe(404);
    const { rows } = await pg.query<{ due: boolean }>("select deadline < now() as due from big_moves");
    expect(rows[0]!.due).toBe(false);
    expect((await call(BIG_MOVES_SHRINK_PATH, { orderId: "0x12" })).status).toBe(400);
    expect((await call(BIG_MOVES_SHRINK_PATH, { orderId: theirs }, null)).status).toBe(401);
  });
});
