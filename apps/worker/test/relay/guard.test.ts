import { RELAY_ALLOWLIST } from "@botfolio/shared";
import { beforeAll, describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { ipKey } from "../../src/auth/client-ip";
import { databaseConfig, type Db } from "../../src/relay/db";
import { PgRelayGuard } from "../../src/relay/guard";
import { NewBotIpLimit } from "../../src/relay/ip-limit";
import { loadRateLimits, type RelayRateLimits } from "../../src/relay/limits";
import type { RelayAttempt, Reservation } from "../../src/relay/ports";
import { OTHER, REGISTRY, TX_HASH, USER, fakeRelay, lower, relayInput, signedRequest } from "./helpers/fakes";
import { testDb } from "./helpers/db";

const LIMITS: RelayRateLimits = { perWalletPerDay: 30, perHourGlobal: 2000, newBotsPerIpPerDay: 3 };
const CREATE = RELAY_ALLOWLIST[0];
const SET_ACTIVE = RELAY_ALLOWLIST[1];

// Booting PGlite and applying schema.sql can take longer than one test's timeout on CI.
beforeAll(async () => void (await testDb()), 60_000);

const walletNo = (n: number) => `0x${(n + 1).toString(16).padStart(40, "0")}` as Address;
const hashNo = (n: number) => `0x${(n + 1).toString(16).padStart(64, "0")}` as Hex;

function attempt(over: Partial<RelayAttempt> = {}): RelayAttempt {
  return { wallet: lower(USER.address), target: REGISTRY, selector: SET_ACTIVE.selector, action: SET_ACTIVE, ip: "203.0.113.9", ...over };
}
const creating = (n: number, ip = "203.0.113.9") =>
  attempt({ wallet: walletNo(n), selector: CREATE.selector, action: CREATE, ip });

async function setup(limits: Partial<RelayRateLimits> = {}) {
  const { db, pg } = await testDb();
  let time = Date.now();
  const guard = new PgRelayGuard(db, { ...LIMITS, ...limits }, () => time);
  const rows = async () =>
    (await pg.query<{ status: string; tx_hash: string | null; user_wallet: string; gas_used: number | null }>(
      "select status, tx_hash, user_wallet, gas_used from relay_log order by id",
    )).rows;
  const seed = (status: string, count: number, ago = "5 minutes", wallet: string = lower(USER.address)) =>
    pg.query(
      `insert into relay_log (user_wallet, status, created_at)
       select $1, $2::relay_status, now() - $4::interval from generate_series(1, $3::int)`,
      [wallet, status, count, ago],
    );
  return { db, pg, guard, rows, seed, advance: (ms: number) => (time += ms) };
}

const refused = (code: string) => ({ code });
const won = (results: PromiseSettledResult<Reservation>[]) => results.filter((r) => r.status === "fulfilled").length;

describe("per-wallet limit (#39)", () => {
  it("refuses relay 31 in a day, with a retry time", async () => {
    const t = await setup();
    await t.seed("confirmed", 29);
    await (await t.guard.reserve(attempt())).recordOutcome("confirmed", 1n, TX_HASH);
    const error = await t.guard.reserve(attempt()).catch((e) => e);
    expect(error).toMatchObject(refused("RATE_LIMITED_USER"));
    expect(error.details.retryAfterSeconds).toBeGreaterThan(86_000);
    expect(error.details.retryAfterSeconds).toBeLessThanOrEqual(86_400);
  });

  it("counts reverted relays: they cost gas", async () => {
    const t = await setup();
    await t.seed("reverted", 30);
    await expect(t.guard.reserve(attempt())).rejects.toMatchObject(refused("RATE_LIMITED_USER"));
  });

  it("doesn't count refusals, so retrying can't extend a lockout", async () => {
    const t = await setup();
    await t.seed("rejected", 100);
    expect((await t.guard.reserve(attempt())).id).toBeTruthy();
  });

  it("rolls off after 24 h", async () => {
    const t = await setup();
    await t.seed("confirmed", 30, "25 hours");
    expect((await t.guard.reserve(attempt())).id).toBeTruthy();
  });

  it("is per wallet", async () => {
    const t = await setup();
    await t.seed("confirmed", 30);
    expect((await t.guard.reserve(attempt({ wallet: lower(OTHER.address) }))).id).toBeTruthy();
  });

  it("is per Privy user: all of the user's wallets share one 30 (#219)", async () => {
    const t = await setup();
    await t.seed("confirmed", 30); // all from USER's wallet
    const both = [lower(USER.address), lower(OTHER.address)];
    await expect(t.guard.reserve(attempt({ wallet: lower(OTHER.address), userWallets: both }))).rejects.toMatchObject(
      refused("RATE_LIMITED_USER"),
    );
  });

  it("counts a SIWE login and a Privy login for one wallet together", async () => {
    const t = await setup({ perWalletPerDay: 1 });
    await t.pg.query("insert into users (wallet_address, terms_accepted_at) values ($1, now())", [lower(USER.address)]);
    const send = async (kind: "siwe" | "privy") => {
      const auth = { authenticate: async () => ({ kind, wallets: [lower(USER.address)] }) };
      const sender = {
        send: async ({ reservation }: { reservation: Reservation }) => {
          await reservation.recordSigned(TX_HASH);
          await reservation.recordOutcome("confirmed", 1n, TX_HASH);
          return { txHash: TX_HASH };
        },
      };
      return (await fakeRelay({ auth, guard: t.guard, sender }).relay(relayInput(await signedRequest()))).body;
    };
    expect(await send("siwe")).toMatchObject({ ok: true });
    expect(await send("privy")).toMatchObject({ error: refused("RATE_LIMITED_USER") });
  });

  it("lets one relay through when a signed request is fired 15 times at once", async () => {
    const t = await setup();
    const results = await Promise.allSettled(Array.from({ length: 15 }, () => t.guard.reserve(attempt())));
    expect(won(results)).toBe(1);
    expect(await t.rows()).toHaveLength(1);
  });

  it("stops blocking on a lost in-flight row after 11 min, but still counts it", async () => {
    const t = await setup({ perWalletPerDay: 2 });
    await t.seed("submitted", 1, "10 minutes");
    await expect(t.guard.reserve(attempt())).rejects.toMatchObject(refused("RATE_LIMITED_USER"));
    await t.pg.query("update relay_log set created_at = now() - interval '12 minutes'");
    await (await t.guard.reserve(attempt())).recordOutcome("confirmed", 1n, TX_HASH);
    await expect(t.guard.reserve(attempt())).rejects.toMatchObject(refused("RATE_LIMITED_USER"));
  });
});

describe("global limit (#39)", () => {
  it("can't be beaten by 40 wallets at once", async () => {
    const t = await setup({ perHourGlobal: 25 });
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) => t.guard.reserve(attempt({ wallet: walletNo(i) }))),
    );
    expect(won(results)).toBe(25);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject(refused("RATE_LIMITED_GLOBAL"));
  });

  it("takes the advisory lock before it counts, and counts before it inserts, in one transaction", async () => {
    // PGlite has one connection, so it can't show two connections racing. This pins what makes that race safe.
    const { db } = await testDb();
    const statements: string[] = [];
    const spy: Db = {
      ...db,
      transaction: (run) =>
        db.transaction((tx) =>
          run({
            query: (sql, params) => {
              statements.push(sql);
              return tx.query(sql, params);
            },
          }),
        ),
    };
    await new PgRelayGuard(spy, LIMITS).reserve(attempt());
    const at = (part: string) => statements.findIndex((sql) => sql.includes(part));
    expect(at("pg_advisory_xact_lock")).toBeGreaterThanOrEqual(0);
    expect(at("pg_advisory_xact_lock")).toBeLessThan(at("wallet_count"));
    expect(at("wallet_count")).toBeLessThan(at("insert into relay_log"));
  });

  it("is a rolling hour", async () => {
    const t = await setup({ perHourGlobal: 5 });
    await t.seed("confirmed", 5, "61 minutes", walletNo(1));
    expect((await t.guard.reserve(attempt())).id).toBeTruthy();
  });

  it("can't be used up with refusals", async () => {
    const t = await setup({ perHourGlobal: 5 });
    await t.seed("rejected", 50, "1 minute", walletNo(1));
    expect((await t.guard.reserve(attempt())).id).toBeTruthy();
  });

  it("gives the IP slot back when the global limit refuses", async () => {
    const t = await setup({ perHourGlobal: 1, newBotsPerIpPerDay: 1 });
    const first = await t.guard.reserve(attempt());
    await expect(t.guard.reserve(creating(5))).rejects.toMatchObject(refused("RATE_LIMITED_GLOBAL"));
    await first.release();
    expect((await t.guard.reserve(creating(5))).id).toBeTruthy();
  });
});

describe("new bots per IP (#39)", () => {
  it("lets exactly 3 of 12 parallel createBots through", async () => {
    const t = await setup();
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => t.guard.reserve(creating(i))));
    expect(won(results)).toBe(3);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject(refused("RATE_LIMITED_IP"));
  });

  it("only limits createBot", async () => {
    const t = await setup({ newBotsPerIpPerDay: 1 });
    await t.guard.reserve(creating(0));
    expect((await t.guard.reserve(attempt({ wallet: walletNo(1) }))).id).toBeTruthy();
  });

  it("gives the slot back when nothing was sent", async () => {
    const t = await setup({ newBotsPerIpPerDay: 1 });
    const first = await t.guard.reserve(creating(0));
    await first.release();
    await first.release();
    await t.guard.reserve(creating(1));
    await expect(t.guard.reserve(creating(2))).rejects.toMatchObject(refused("RATE_LIMITED_IP"));
  });

  it("keeps the slot once broadcast, for a day", async () => {
    const t = await setup({ newBotsPerIpPerDay: 1 });
    await (await t.guard.reserve(creating(0))).recordOutcome("confirmed", 1n, hashNo(0));
    await expect(t.guard.reserve(creating(1))).rejects.toMatchObject(refused("RATE_LIMITED_IP"));
    t.advance(86_400_001);
    expect((await t.guard.reserve(creating(1))).id).toBeTruthy();
  });

  it("can't be dodged by rotating inside an IPv6 /64", async () => {
    const t = await setup({ newBotsPerIpPerDay: 1 });
    await t.guard.reserve(creating(0, ipKey("2001:db8:1:2::1")));
    await expect(t.guard.reserve(creating(1, ipKey("2001:db8:1:2:ffff::9")))).rejects.toMatchObject(
      refused("RATE_LIMITED_IP"),
    );
  });

  it("refuses new IPs when the map is full", () => {
    const limit = new NewBotIpLimit(3, Date.now, 2);
    limit.tryReserve("a");
    limit.tryReserve("b");
    expect(limit.tryReserve("c")).toHaveProperty("retryAfterSeconds");
  });
});

describe("relay_log (#39)", () => {
  it("records reserve, hash and outcome on one row", async () => {
    const t = await setup();
    const reservation = await t.guard.reserve(attempt());
    expect((await t.rows())[0]).toMatchObject({ status: "submitted", tx_hash: null });
    await reservation.recordSigned(TX_HASH);
    await reservation.recordOutcome("confirmed", 123_456n, TX_HASH);
    const rows = await t.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "confirmed", tx_hash: TX_HASH, user_wallet: lower(USER.address) });
    expect(Number(rows[0]!.gas_used)).toBe(123_456);
  });

  it("logs every kind of refusal after auth", async () => {
    const t = await setup();
    const f = fakeRelay({ guard: t.guard });
    await f.relay(relayInput(await signedRequest({ value: 1n }))); // before reserving
    f.chain.prepare.mockRejectedValue(new Error("node fell over"));
    await f.relay(relayInput(await signedRequest())); // after reserving
    expect((await t.rows()).map((r) => r.status)).toEqual(["rejected", "rejected"]);
  });

  it("writes nothing for a wallet that isn't proven", async () => {
    const t = await setup();
    const f = fakeRelay({ guard: t.guard });
    await f.relay(relayInput(await signedRequest({}, undefined, OTHER)));
    expect(await t.rows()).toHaveLength(0);
  });

  it("never counts a cancel tx or a revert as user activity", async () => {
    const t = await setup();
    await (await t.guard.reserve(attempt())).recordOutcome("cancelled", 21_000n, TX_HASH);
    await (await t.guard.reserve(attempt({ wallet: walletNo(1) }))).recordOutcome("reverted", 50_000n, hashNo(1));
    const stats = await t.pg.query<{ user_signed_txs: number; unique_signers: number }>("select * from site_activity_stats");
    expect(Number(stats.rows[0]!.user_signed_txs)).toBe(0);
    expect(Number(stats.rows[0]!.unique_signers)).toBe(0);
  });

  it("won't let a closed row take a new hash, so nothing is broadcast off it", async () => {
    const t = await setup();
    const reservation = await t.guard.reserve(attempt());
    await reservation.release();
    await expect(reservation.recordSigned(TX_HASH)).rejects.toMatchObject({ reason: "reservation_lost" });
  });

  it("finds open rows after a restart", async () => {
    const t = await setup();
    await (await t.guard.reserve(attempt())).recordSigned(TX_HASH);
    await t.guard.reserve(attempt({ wallet: walletNo(1) })); // never signed
    const open = await new PgRelayGuard(t.db, LIMITS).openRelays();
    expect(open.map((o) => o.txHash)).toEqual([TX_HASH]);
    await open[0]!.reservation.recordOutcome("confirmed", 1n, TX_HASH);
    expect((await t.rows())[0]!.status).toBe("confirmed");
  });

  it("caps refusal rows from one wallet", async () => {
    const t = await setup();
    for (let i = 0; i < 25; i++) await t.guard.recordRefusal(attempt());
    expect(await t.rows()).toHaveLength(20);
  });

  it("throttles attempts that never broadcast (#155)", async () => {
    const t = await setup();
    for (let i = 0; i < 20; i++) await (await t.guard.reserve(attempt())).release();
    await expect(t.guard.reserve(attempt())).rejects.toMatchObject(refused("RATE_LIMITED_USER"));
    t.advance(60_000);
    expect((await t.guard.reserve(attempt())).id).toBeTruthy();
  });

  it("broadcasts nothing when the DB is down, and keeps no IP slot", async () => {
    const down: Db = {
      query: () => Promise.reject(new Error("ECONNREFUSED postgres://user:hunter2@db")),
      transaction: () => Promise.reject(new Error("ECONNREFUSED postgres://user:hunter2@db")),
      close: async () => {},
    };
    const f = fakeRelay({ guard: new PgRelayGuard(down, LIMITS) });
    const result = await f.relay(relayInput(await signedRequest()));
    expect(result.body).toMatchObject({ error: refused("INTERNAL") });
    expect(f.chain.prepare).not.toHaveBeenCalled();
    expect(f.sender.send).not.toHaveBeenCalled();
    expect(JSON.stringify([result.body, f.log.mock.calls])).not.toContain("hunter2");
  });
});

describe("limits and DB from env (#39)", () => {
  it("defaults to SPEC §11 and reads the §10 names", () => {
    expect(loadRateLimits({})).toEqual({ ok: true, limits: LIMITS });
    const env = { RELAY_MAX_PER_USER_PER_DAY: "5", RELAY_MAX_GLOBAL_PER_HOUR: "100", NEW_BOTS_PER_IP_PER_DAY: "1" };
    expect(loadRateLimits(env)).toEqual({
      ok: true,
      limits: { perWalletPerDay: 5, perHourGlobal: 100, newBotsPerIpPerDay: 1 },
    });
  });

  it.each(["0", "-1", "Infinity", "30abc", "1e9", "replace-me"])("refuses a limit of %s", (value) => {
    expect(loadRateLimits({ RELAY_MAX_GLOBAL_PER_HOUR: value })).toEqual({
      ok: false,
      problems: ["RELAY_MAX_GLOBAL_PER_HOUR"],
    });
  });

  it("hasAcceptedTerms: any of the user's wallets, or the Privy DID, with a users row (#219)", async () => {
    const t = await setup();
    const user = { wallets: [lower(USER.address)], privyDid: "did:privy:1" };
    expect(await t.guard.hasAcceptedTerms(user)).toBe(false);
    await t.pg.query("insert into users (wallet_address, privy_did, terms_accepted_at) values ($1, 'did:privy:1', now())", [
      lower(OTHER.address),
    ]);
    expect(await t.guard.hasAcceptedTerms(user)).toBe(true); // same Privy user, other wallet
    expect(await t.guard.hasAcceptedTerms({ wallets: [lower(OTHER.address)] })).toBe(true);
    expect(await t.guard.hasAcceptedTerms({ wallets: [walletNo(77)] })).toBe(false);
  });

  it("bigMoveSeasonEnded: only a big move whose decision's season has ended (#355)", async () => {
    const t = await setup();
    const zero = `\\x${"00".repeat(32)}`;
    await t.pg.query("insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash) values (7, $1, 'B', 'b', 'p', $2)", [lower(USER.address), zero]);
    await t.pg.query(
      `insert into bot_versions (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source)
       values (7, 1, 'r', 2500, 4, '{}', $1, 'create')`,
      [zero],
    );
    await t.pg.exec(`insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades) values
      (0, now() - interval '2 days', now() - interval '1 minute', 'sprint', 8),
      (1, now() - interval '1 hour', now() + interval '1 day', 'sprint', 8)`);
    const move = async (n: number, season: number | null) => {
      const { rows: s } = await t.pg.query<{ id: string }>(
        "insert into slots (slot_time, kind, season_id) values (now(), 'scheduled', $1) returning id::text as id",
        [season],
      );
      const { rows: d } = await t.pg.query<{ id: string }>(
        `insert into decisions (bot_id, version, slot_id, prompt_version, model, input_json, input_hash, status)
         values (7, 1, $1, 'p', 'm', '{}', $2, 'executed') returning id::text as id`,
        [s[0]!.id, zero],
      );
      await t.pg.query(
        `insert into big_moves (decision_id, action_index, order_id, bot_id, asset, side, bps, runner_sig, deadline)
         values ($1, 0, decode($2, 'hex'), 7, 'GOLD', 'BUY', 3500, '\\x00', now() + interval '2 hours')`,
        [d[0]!.id, hashNo(n).slice(2)],
      );
    };
    await move(1, 0);
    await move(2, 1);
    await move(3, null);
    expect(await t.guard.bigMoveSeasonEnded(hashNo(1))).toBe(true);
    expect(await t.guard.bigMoveSeasonEnded(hashNo(2))).toBe(false);
    expect(await t.guard.bigMoveSeasonEnded(hashNo(3))).toBe(false); // between seasons
    expect(await t.guard.bigMoveSeasonEnded(hashNo(4))).toBe(false); // no row: the chain decides
  });

  it("wants TLS for a remote database", () => {
    expect(databaseConfig("postgres://u:p@db.example:5432/app")).toMatchObject({ ssl: true });
    expect(databaseConfig("postgres://u:p@db.example/app?sslmode=verify-full")).not.toBeNull();
    expect(databaseConfig("postgres://u:p@127.0.0.1/app")).not.toBeNull();
  });

  it.each([
    undefined,
    "replace-me",
    "postgres://u:replace-me@db.example/app",
    "https://db.example",
    "postgres://u:p@db.example/app?sslmode=disable",
    "postgres://u:p@db.example/app?sslmode=no-verify",
    "postgres://u:p@localhost/app?host=db.example",
    "postgres://u:p@db.example/app?sslmode=require&sslmode=disable",
  ])("refuses DATABASE_URL %s", (url) => {
    expect(databaseConfig(url)).toBeNull();
  });
});
