import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InternalFailure } from "../../src/auth/log";
import type { Authenticator, Identity } from "../../src/auth/types";
import { HealthState } from "../../src/health";
import { ME_DELETE_PATH, meRoutes } from "../../src/me/delete";
import type { Db } from "../../src/relay/db";
import { buildReplayFile } from "../../src/season/replay-file";
import { createWorkerServer } from "../../src/server";

const SCHEMA = readFileSync(new URL("../../../../packages/db/schema.sql", import.meta.url), "utf8");
const OWNER = `0x${"a1".repeat(20)}`;
const SECOND = `0x${"a2".repeat(20)}`; // another wallet linked to the same Privy user
const OTHER = `0x${"b2".repeat(20)}`;
const DID = "did:privy:owner123";
const ORIGIN = "https://app.example";
const hash = (byte: string) => `\\x${byte.repeat(32)}`;
const tx = (byte: string) => `0x${byte.repeat(32)}`;
const CONTRACTS = { chainId: 1990, seasonLedger: `0x${"5e".repeat(20)}`, paperLedger: `0x${"9a".repeat(20)}`, fromBlock: "1" } as const;

let pg: PGlite;
let server: Server;
let base: string;
const log = vi.fn();
const privy = { deleteUser: vi.fn(async (_did: string) => {}) };

/** Bearer `siwe:<wallet>` or `privy:<did>`, so the test picks who is calling. */
const auth: Authenticator = {
  async authenticate(headers) {
    const [kind, who] = (headers.authorization ?? "").replace(/^Bearer /, "").split(":", 2) as [string, string];
    if (kind === "siwe" && who) return { kind: "siwe", wallets: [who as Identity["wallets"][number]] };
    if (kind === "privy" && who === "owner123") return { kind: "privy", wallets: [OWNER, SECOND] as Identity["wallets"], privyDid: DID };
    return null;
  },
};

async function call(as: string | null, body: unknown = { confirm: true }) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN };
  if (as) headers.authorization = `Bearer ${as}`;
  const res = await fetch(`${base}${ME_DELETE_PATH}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function user(wallet: string, did: string | null) {
  await pg.query(
    `insert into users (wallet_address, privy_did, terms_accepted_at, flags)
     values ($1, $2, now(), '{"personas": {"0xab": {"name": "Draft", "persona": "my secret idea"}}}')`,
    [wallet, did],
  );
  await pg.query("insert into qie_names (wallet_address, qie_name) values ($1, $2)", [wallet, `${wallet.slice(2, 6)}.qie`]);
}

/** A bot with one version, decision, trade, mark and on-chain correction (with a note) in season 1. */
async function bot(id: number, owner: string, byte: string, opts: { house?: boolean } = {}) {
  await pg.query(
    "insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash, created_tx, is_house) values ($1, $2, $3, 'b', $4, $5, $6, $7)",
    [id, owner, `Bot${id}`, `persona of ${id}`, hash(byte), tx(byte), opts.house ?? false],
  );
  await pg.query(
    `insert into bot_versions (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source, committed_tx)
     values ($1, 1, 'r', 2500, 4, '{}', $2, 'create', $3)`,
    [id, hash(byte), tx(byte)],
  );
  const { rows } = await pg.query<{ id: string }>(
    `insert into decisions (bot_id, version, slot_id, prompt_version, model, input_json, input_hash, status)
     values ($1, 1, 1, 'p', 'm', $2, $3, 'executed') returning id`,
    [id, JSON.stringify({ bot: { persona: `persona of ${id}` } }), hash(byte)],
  );
  const decision = rows[0]!.id;
  await pg.query(
    `insert into trades (decision_id, action_index, order_id, bot_id, asset, side, cash_e8, units_e18, price_e8, round_id, tx_hash, log_index, block_number)
     values ($1, 0, $2, $3, 'BTC', 'BUY', 100, 1, 100, 1, $4, 0, 10)`,
    [decision, hash(`${byte[1]}f`), id, tx(byte)],
  );
  await pg.query("insert into portfolio_marks (bot_id, slot_id, cash_e8, holdings, value_e8) values ($1, 1, 100, '{}', 100)", [id]);
  await pg.query(
    `insert into corrections (bot_id, decision_id, user_wallet, chip, note, note_hash, tx_hash, created_at)
     values ($1, $2, $3, 'too risky', 'my private note', $4, $5, '2026-11-25T10:00:00Z')`,
    [id, decision, owner, hash(`${byte[1]}e`), tx(`${byte[1]}d`)],
  );
  await pg.query(
    `insert into trust_scores (season_id, bot_id, rules_version, f_rules, f_drawdown, f_consistency, f_explains, total, provisional, leaf_hash)
     values (1, $1, 'trust-v1', 1, 1, 1, 1, 4, true, $2)`,
    [id, hash(byte)],
  );
  await pg.query("insert into relay_log (user_wallet, status, tx_hash) values ($1, 'confirmed', $2)", [owner, tx(byte)]);
}

/** Everything replay, boards and the indexer read, apart from the fields deletion is meant to change. */
async function onChainSide() {
  const rows = async (sql: string) => (await pg.query(sql)).rows;
  return {
    replay: (await buildReplayFile({ query: async (sql, params) => ({ rows: (await pg.query(sql, params)).rows as never[] }) }, 1, CONTRACTS)).root,
    bots: await rows("select id, owner_wallet, name, emoji, persona_hash, created_tx, status from bots order by id"),
    versions: await rows("select * from bot_versions order by bot_id"),
    decisions: await rows("select * from decisions order by bot_id"),
    trades: await rows("select * from trades order by id"),
    marks: await rows("select * from portfolio_marks order by bot_id"),
    corrections: await rows("select id, bot_id, decision_id, user_wallet, chip, note_hash, tx_hash from corrections order by id"),
    trust: await rows("select * from trust_scores order by bot_id"),
    relayLog: await rows("select * from relay_log order by id"),
  };
}

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
  await pg.query(
    "insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades) values (1, '2026-11-24T00:00:00Z', '2026-11-26T00:00:00Z', 'sprint', 8)",
  );
  await pg.query("insert into slots (slot_time, kind, season_id) values ('2026-11-25T03:30:00Z', 'scheduled', 1)");
  await user(OWNER, DID);
  await user(OTHER, null);
  await bot(7, OWNER, "07");
  await bot(8, OTHER, "08");
  await bot(9, OWNER, "09", { house: true });

  const db: Pick<Db, "transaction"> = {
    async transaction(run) {
      return pg.transaction((t) => run({ query: async (sql, params) => ({ rows: (await t.query(sql, params)).rows as never[] }) }));
    },
  };
  privy.deleteUser.mockReset().mockResolvedValue(undefined);
  server = createWorkerServer({
    health: new HealthState({ provider: "fake", capUsd: null }),
    routes: meRoutes({ origins: new Set([ORIGIN]), auth, log, db, privy }),
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  log.mockClear();
}, 30_000);

afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await pg.close();
});

const col = async (sql: string, params: unknown[] = []) => (await pg.query<{ v: unknown }>(sql, params)).rows.map((r) => r.v);

describe("POST /me/delete (#174)", () => {
  it("deletes or blanks only the caller's off-chain data", async () => {
    const res = await call(`siwe:${OWNER}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, deleted: { users: 1, qieNames: 1, correctionNotes: 2, personas: 1 } });

    expect(await col("select wallet_address as v from users")).toEqual([OTHER]);
    expect(await col("select wallet_address as v from qie_names")).toEqual([OTHER]);
    expect(await col("select note as v from corrections order by bot_id")).toEqual([null, "my private note", null]);
    // The house bot is the team's; only the user's own bot loses its text.
    expect(await col("select persona_text as v from bots order by id")).toEqual(["", "persona of 8", "persona of 9"]);
    expect(privy.deleteUser).not.toHaveBeenCalled();
  });

  it("leaves everything replay, boards and trust proofs are built from", async () => {
    const before = await onChainSide();
    expect((await call(`siwe:${OWNER}`)).status).toBe(200);
    expect(await onChainSide()).toEqual(before);
  });

  it("is idempotent", async () => {
    await call(`siwe:${OWNER}`);
    const again = await call(`siwe:${OWNER}`);
    expect(again.body).toEqual({ ok: true, deleted: { users: 0, qieNames: 0, correctionNotes: 0, personas: 0 } });
  });

  it("logs counts, never the wallet or a note", async () => {
    await call(`siwe:${OWNER}`);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("me.deleted");
    expect(logged).not.toMatch(new RegExp(`${OWNER.slice(2)}|private note|persona of|secret idea`));
  });

  it("a Privy login covers all its wallets and its DID, then deletes the Privy user", async () => {
    await pg.query("insert into users (wallet_address, privy_did, terms_accepted_at) values ($1, null, now())", [SECOND]);
    // A row under the DID whose wallet Privy no longer lists.
    await pg.query("update users set privy_did = null where wallet_address = $1", [OWNER]);
    await pg.query("insert into users (wallet_address, privy_did, terms_accepted_at) values ($1, $2, now())", [`0x${"c3".repeat(20)}`, DID]);

    const res = await call("privy:owner123");
    expect(res.status).toBe(200);
    expect(res.body.deleted).toMatchObject({ users: 3 });
    expect(await col("select wallet_address as v from users")).toEqual([OTHER]);
    expect(privy.deleteUser).toHaveBeenCalledWith(DID);
  });

  it("if Privy fails, the data is already gone and a retry finishes the job", async () => {
    privy.deleteUser.mockRejectedValueOnce(new InternalFailure("privy_api_500"));
    const failed = await call("privy:owner123");
    expect(failed.status).toBe(502);
    expect(failed.body).toMatchObject({ error: { code: "PRIVY_DELETE_FAILED" } });
    expect(await col("select wallet_address as v from users")).toEqual([OTHER]);

    expect((await call("privy:owner123")).status).toBe(200);
    expect(privy.deleteUser).toHaveBeenCalledTimes(2);
  });

  it("needs a sign-in and an explicit confirm", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call("siwe:")).status).toBe(401);
    for (const body of [{}, { confirm: "yes" }, null, []]) expect((await call(`siwe:${OWNER}`, body)).status).toBe(400);
    expect(await col("select count(*)::int as v from users")).toEqual([2]);
  });
});
