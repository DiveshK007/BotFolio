import type { PGlite } from "@electric-sql/pglite";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BOT_PAGE_PER_IP_PER_MINUTE, botPageRoutes, type BotPageRouteOptions } from "../../src/bot-page/route";
import { parseHoldings, staleAtCall, type BotPage } from "../../src/bot-page/page";
import { HealthState } from "../../src/health";
import { fetchBotPage } from "../../../web/lib/bot-record";
import type { Queryable } from "../../src/scheduler/db";
import { createWorkerServer } from "../../src/server";
import { testDb } from "../decisions/helpers";

const START = 1000n * 100_000_000n;
const TX = `0x${"ab".repeat(32)}`;
const TX2 = `0x${"cd".repeat(32)}`;
const ist = (time: string) => new Date(`${time}+05:30`);
const at = (time: string) => ist(time).getTime() / 1000;
// The 13:00 call: BTC (twice) and SOL dropped as stale, BTC 52 min old by the gate's clock; ETH dropped for another reason.
const STALE_GATE = {
  events: [
    { kind: "drop", reason: "stale", asset: "BTC", actionIndex: 0, action: "BUY", countsForF1: false },
    { kind: "drop", reason: "stale", asset: "BTC", actionIndex: 1, action: "BUY", countsForF1: false },
    { kind: "drop", reason: "stale", asset: "SOL", actionIndex: 2, action: "BUY", countsForF1: false },
    { kind: "drop", reason: "trade_limit", asset: "ETH", actionIndex: 3, action: "BUY", countsForF1: true },
  ],
  replay: {
    input: { nowSeconds: at("2026-11-26T13:00:00") },
    rounds: [{ asset: "BTC", roundId: "78", priceE8: "1", updatedAt: at("2026-11-26T12:08:00"), fresh: false }],
  },
};

let pg: PGlite;
let db: Queryable;
let server: Server | undefined;
let url: string;

async function start(over: Partial<BotPageRouteOptions> = {}) {
  server = createWorkerServer({
    health: new HealthState({ provider: "fake", capUsd: null }),
    routes: botPageRoutes({ source: { db, startCashE8: async () => START }, origins: new Set(), clientIp: () => "1.2.3.4", now: () => 0, ...over }),
  });
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/bot-page`;
}

beforeEach(async () => {
  ({ pg, db } = await testDb()); // bots 7 and 8
  await pg.exec("update bots set persona_text = '<script>alert(1)</script>', dna_seed = 'pet-99' where id = 7");
  const { rows: slots } = await pg.query<{ id: string }>(
    "insert into slots (slot_time, kind) values ($1, 'scheduled'), ($2, 'scheduled'), ($3, 'scheduled') returning id::text as id",
    [ist("2026-11-26T09:00:00"), ist("2026-11-26T13:00:00"), ist("2026-11-26T17:00:00")],
  );
  const [nine, one, five] = slots.map((s) => s.id);
  const { rows: d } = await pg.query<{ id: string }>(
    `insert into decisions (bot_id, version, slot_id, prompt_version, model, input_json, input_hash, reason, reason_tag, status, gate_result)
     values (7, 1, $1, 'p', 'm', '{}', decode(repeat('00', 32), 'hex'), 'A little BTC on strength.', 'momentum', 'executed', null),
            (7, 1, $2, 'p', 'm', '{}', decode(repeat('00', 32), 'hex'), 'Gold market quiet, holding.', null, 'skipped_stale', $3::jsonb),
            (7, 1, $4, 'p', 'm', '{}', decode(repeat('00', 32), 'hex'), 'Buying SOL.', 'trend_up', 'executed', null)
     returning id::text as id`,
    [nine, one, JSON.stringify(STALE_GATE), five],
  );
  await pg.query(
    `insert into oracle_reads (slot_id, asset, feed, round_id, answer, updated_at, fresh) values
       ($1, 'BTC', '0x${"1".repeat(40)}', 77, 9000000000000, $2, true),
       ($1, 'ETH', '0x${"2".repeat(40)}', 5, 300000000000, $2, true),
       ($3, 'BTC', '0x${"1".repeat(40)}', 78, 9100000000000, $4, true)`,
    [nine, ist("2026-11-26T08:58:00"), one, ist("2026-11-26T12:59:00")],
  );
  // Trade 1 used the slot's round (age known); trade 2 a later round (age unknown) and was an owner-approved Big Move.
  await pg.query(
    `insert into trades (decision_id, action_index, order_id, bot_id, asset, side, cash_e8, units_e18, price_e8, round_id, tx_hash, log_index, block_number)
     values ($1, 0, decode(repeat('aa', 32), 'hex'), 7, 'BTC', 'BUY', 100, 5, 9000000000000, 77, $2, 0, 9),
            ($1, 1, decode(repeat('bb', 32), 'hex'), 7, 'ETH', 'BUY', 100, 5, 300000000000, 6, $3, 0, 10)`,
    [d[0]!.id, TX, TX2],
  );
  await pg.query(
    `insert into big_moves (decision_id, action_index, order_id, bot_id, asset, side, bps, runner_sig, deadline, status, user_tx)
     values ($1, 1, decode(repeat('bb', 32), 'hex'), 7, 'ETH', 'BUY', 4000, '\\x00', now(), 'approved', $2)`,
    [d[0]!.id, TX2],
  );
  await pg.query("insert into portfolio_marks (bot_id, slot_id, cash_e8, holdings, value_e8) values (7, $1, 1, '{}', 1), (7, $2, $3, $4, $5)", [
    nine,
    one,
    "90000000000",
    JSON.stringify({ BTC: { units_e18: "1000", value_e8: "11000000000" }, DOGE: { units_e18: "1", value_e8: "1" } }),
    "101000000000",
  ]);
}, 30_000);

afterEach(async () => {
  if (server) await new Promise<void>((done) => server!.close(() => done()));
  server = undefined;
  await pg.close();
});

describe("GET /bot-page", () => {
  it("returns the record, the latest mark with its oracle reads, and every call newest first", async () => {
    await start();
    const res = await fetch(`${url}?bot=7`);
    expect(res.status).toBe(200);
    const { page } = (await res.json()) as { page: BotPage };

    expect(page.bot.persona).toBe("<script>alert(1)</script>"); // raw text: the web renders it as text, never HTML
    expect(page.bot.dna_seed).toBe("pet-99");
    expect(page.start_cash_e8).toBe(START.toString());
    expect(page.versions[0]).toMatchObject({ version: 1, config_hash: `0x${"00".repeat(32)}` });

    expect(page.mark).toMatchObject({ slot_time: ist("2026-11-26T13:00:00").toISOString(), cash_e8: "90000000000", value_e8: "101000000000" });
    expect(page.mark!.holdings).toEqual([{ asset: "BTC", units_e18: "1000", value_e8: "11000000000" }]);
    expect(page.mark!.prices).toEqual([
      { asset: "BTC", round_id: "78", answer_e8: "9100000000000", updated_at: ist("2026-11-26T12:59:00").toISOString(), fresh: true },
    ]);

    const byReason = Object.fromEntries(page.decisions.map((d) => [d.reason, d]));
    expect(page.decisions.map((d) => d.slot_time)).toEqual(["17:00", "13:00", "09:00"].map((t) => ist(`2026-11-26T${t}:00`).toISOString()));
    expect(page.decisions[2]).toMatchObject({ reason: "A little BTC on strength.", reason_tag: "momentum", slot_kind: "scheduled", traded: true, stale: [] });
    // Accepted by the gate but no mined trade (yet): the page must not call it traded.
    expect(byReason["Buying SOL."]).toMatchObject({ status: "executed", traded: false, stale: [] });
    // One entry per asset; SOL has no round in the replay, so it has no age to show.
    expect(byReason["Gold market quiet, holding."]).toMatchObject({ status: "skipped_stale", traded: false, stale: [{ asset: "BTC", age_s: 52 * 60 }] });

    const byTx = Object.fromEntries(page.trades.map((t) => [t.tx_hash, t]));
    expect(byTx[TX]).toMatchObject({ round_id: "77", owner_signed: false, oracle_updated_at: ist("2026-11-26T08:58:00").toISOString(), decision_id: page.decisions[2]!.id });
    expect(byTx[TX2]).toMatchObject({ round_id: "6", owner_signed: true, oracle_updated_at: null });
  });

  it("answers in the shape apps/web's fetchBotPage accepts, no row dropped", async () => {
    await start();
    const base = url.replace(/\/bot-page$/, "");
    const raw = ((await (await fetch(`${url}?bot=7`)).json()) as { page: BotPage }).page;
    const result = await fetchBotPage("7", base);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const { page } = result;
    // parseBotPage drops a bad row quietly, so compare counts against what the worker sent.
    expect(page.bot.id).toBe("7");
    expect(page.versions).toHaveLength(raw.versions.length);
    expect(page.trades).toHaveLength(raw.trades.length);
    expect(page.decisions).toHaveLength(raw.decisions.length);
    expect(page.mark!.holdings).toHaveLength(raw.mark!.holdings.length);
    expect(page.mark!.prices).toHaveLength(raw.mark!.prices.length);
    expect(page.trades.length).toBeGreaterThan(0);
  });

  it("maps the worker's 404 and 503 onto apps/web's results", async () => {
    await start();
    expect(await fetchBotPage("404", url.replace(/\/bot-page$/, ""))).toEqual({ kind: "not_found" });
    await new Promise<void>((done) => server!.close(() => done()));
    await start({ source: null });
    expect(await fetchBotPage("7", url.replace(/\/bot-page$/, ""))).toEqual({ kind: "not_live" });
  });

  it("a bot with no marks or calls yet still has a page", async () => {
    await start();
    const { page } = (await (await fetch(`${url}?bot=8`)).json()) as { page: BotPage };
    expect(page.mark).toBeNull();
    expect(page.decisions).toEqual([]);
    expect(page.trades).toEqual([]);
    expect(page.trust).toBeNull();
  });

  it("404 for an unknown bot, 400 for a bad id, 503 when not configured, 429 when flooded", async () => {
    await start();
    expect((await fetch(`${url}?bot=404`)).status).toBe(404);
    for (const bad of ["", "0", "-1", "7x", "1e3"]) expect((await fetch(`${url}?bot=${bad}`)).status).toBe(400);
    await new Promise<void>((done) => server!.close(() => done()));

    await start({ source: null });
    expect((await fetch(`${url}?bot=7`)).status).toBe(503);
    await new Promise<void>((done) => server!.close(() => done()));

    await start();
    for (let i = 0; i < BOT_PAGE_PER_IP_PER_MINUTE; i++) await fetch(`${url}?bot=404`);
    const flooded = await fetch(`${url}?bot=7`);
    expect(flooded.status).toBe(429);
    expect(flooded.headers.get("retry-after")).toBe("60");
  });
});

describe("parseHoldings", () => {
  it("keeps only the five assets with digit amounts and non-zero units", () => {
    expect(parseHoldings(null)).toEqual([]);
    expect(parseHoldings([])).toEqual([]);
    expect(
      parseHoldings({
        GOLD: { units_e18: "5", value_e8: "6" },
        BTC: { units_e18: "0", value_e8: "0" },
        ETH: { units_e18: "1.5", value_e8: "2" },
        SOL: "x",
        __proto__: { XRP: { units_e18: "1", value_e8: "1" } },
      }),
    ).toEqual([{ asset: "GOLD", units_e18: "5", value_e8: "6" }]);
  });
});

describe("staleAtCall", () => {
  it("is empty for a missing or off-shape gate_result", () => {
    expect(staleAtCall(null)).toEqual([]);
    expect(staleAtCall({ events: "x" })).toEqual([]);
    expect(staleAtCall({ events: STALE_GATE.events })).toEqual([]); // no gate clock
    expect(staleAtCall({ ...STALE_GATE, events: [{ kind: "drop", reason: "stale", asset: "DOGE" }] })).toEqual([]);
  });
  it("never shows a negative age", () => {
    expect(staleAtCall({ ...STALE_GATE, replay: { ...STALE_GATE.replay, input: { nowSeconds: 0 } } })).toEqual([{ asset: "BTC", age_s: 0 }]);
  });
});
