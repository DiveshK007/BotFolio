import type { PGlite } from "@electric-sql/pglite";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HealthState } from "../../src/health";
import { MCP_PER_IP_PER_MINUTE, mcpRoutes, type McpOptions } from "../../src/mcp/mcp";
import type { TradeCheck } from "../../src/mcp/verify-trade";
import type { Queryable } from "../../src/scheduler/db";
import { createWorkerServer } from "../../src/server";
import { computeTrustScores, saveTrustScores } from "../../src/trust/scores";
import { testDb } from "../decisions/helpers";

const ist = (time: string) => new Date(`${time}+05:30`);
const TX = `0x${"ab".repeat(32)}` as Hex;

let pg: PGlite;
let db: Queryable;
let server: Server | undefined;
let url: string;
const checked: Hex[] = [];

const verifyTrade = async (tx: Hex): Promise<TradeCheck> => {
  checked.push(tx);
  return { tx_hash: tx, valid: true, matches_oracle: true, block_number: "9", trades: [], note: "n" };
};

async function start(over: Partial<McpOptions> = {}) {
  server = createWorkerServer({
    health: new HealthState({ provider: "fake", capUsd: null }),
    routes: mcpRoutes({ source: { db, startCashE8: async () => 1000n * 100_000_000n, verifyTrade }, clientIp: () => "1.2.3.4", now: () => 0, ...over }),
  });
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}

const post = (body: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
const rpc = async (method: string, params?: object, id: number | string = 1) => (await (await post({ jsonrpc: "2.0", id, method, params })).json()) as {
  id: number | string;
  result?: { content?: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean } & Record<string, unknown>;
  error?: { code: number };
};
const tool = async (name: string, args: object) => (await rpc("tools/call", { name, arguments: args })).result!;

beforeEach(async () => {
  ({ pg, db } = await testDb()); // bots 7 and 8
  await pg.exec(`
    update bots set name = 'AlphaWolf', emoji = '🐺' where id = 7;
    update bots set name = 'Twin' where id = 8;
    insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash) values (9, '0x${"9".repeat(40)}', 'twin', 't', '', decode(repeat('00', 32), 'hex'));
    update bot_versions set committed_tx = '0x${"01".repeat(32)}' where bot_id = 7;
    insert into bot_versions (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source)
    values (7, 2, 'proposed', 2000, 4, '{}', decode(repeat('22', 32), 'hex'), 'season_v2');`);
  await pg.query("insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades, trust_rules_version, status) values (1, $1, $2, 'sprint', 8, 'trust-v1-sprint', 'closed')", [
    ist("2026-11-26T00:00:00"),
    ist("2026-11-27T21:30:00"),
  ]);
  await pg.query("insert into slots (slot_time, kind, season_id) values ($1, 'scheduled', 1)", [ist("2026-11-26T09:00:00")]);
  const { rows: slot } = await pg.query<{ id: string }>("select id::text as id from slots");
  const { rows: d } = await pg.query<{ id: string }>(
    `insert into decisions (bot_id, version, slot_id, prompt_version, model, input_json, input_hash, reason, status)
     values (7, 1, $1, 'p', 'm', '{}', decode(repeat('00', 32), 'hex'), 'A little BTC on strength.', 'executed') returning id::text as id`,
    [slot[0]!.id],
  );
  await pg.query(
    `insert into trades (decision_id, action_index, order_id, bot_id, asset, side, cash_e8, units_e18, price_e8, round_id, tx_hash, log_index, block_number)
     values ($1, 0, decode(repeat('aa', 32), 'hex'), 7, 'BTC', 'BUY', 100, 5, 9000000000000, 77, $2, 0, 9)`,
    [d[0]!.id, TX],
  );
  await pg.query("insert into portfolio_marks (bot_id, slot_id, cash_e8, holdings, value_e8) values (7, $1, 0, '{}', 110000000000)", [slot[0]!.id]);
  await pg.exec(`
    insert into season_results (season_id, bot_id, start_value_e8, end_value_e8, return_bps, sortino, max_dd_bps, trades, battle_rank)
    values (1, 7, 100000000000, 110000000000, 1000, null, 0, 1, 1)`);
  await saveTrustScores(db, 1, "trust-v1-sprint", await computeTrustScores(db, 1, 1000n * 100_000_000n));
  checked.length = 0;
}, 30_000);
afterEach(async () => {
  if (server) await new Promise<void>((done) => server!.close(() => done()));
  server = undefined;
  await pg.close();
});

describe("BotFolio MCP server (SPEC §10.1)", () => {
  it("initializes, agreeing on the client's version when it knows it", async () => {
    await start();
    const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "botfolio" } });
    expect(String(init.result!.instructions)).toContain("settled against QIE's official mainnet oracle");
    expect((await rpc("initialize", { protocolVersion: "1999-01-01" })).result!.protocolVersion).toBe("2025-06-18");

    const note = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.status).toBe(202);
    expect((await rpc("ping")).result).toEqual({});
  });

  it("lists exactly the three read-only tools", async () => {
    await start();
    const { tools } = (await rpc("tools/list")).result as { tools: { name: string; annotations: { readOnlyHint: boolean } }[] };
    expect(tools.map((t) => t.name)).toEqual(["get_bot_record", "get_leaderboard", "verify_trade"]);
    expect(tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
  });

  it("get_bot_record: versions with hashes, trades, results and the trust proof; by id or by name", async () => {
    await start();
    const out = await tool("get_bot_record", { bot_id: 7 });
    const record = out.structuredContent as {
      bot: { name: string }; versions: { version: number; config_hash: string }[]; trades: { tx_hash: string; round_id: string; reason: string }[];
      seasons: { season: number; return_bps: number }[]; trust: { total: number; proof: string[]; season: number };
    };
    expect(record.bot.name).toBe("AlphaWolf");
    expect(record.versions.map((v) => v.version)).toEqual([1]); // the uncommitted proposal isn't a version yet
    expect(record.trades).toEqual([expect.objectContaining({ tx_hash: TX, round_id: "77", reason: "A little BTC on strength." })]);
    expect(record.seasons).toEqual([expect.objectContaining({ season: 1, return_bps: 1000 })]);
    expect(record.trust).toMatchObject({ season: 1 });
    expect(JSON.parse(out.content![0]!.text)).toEqual(record);

    expect((await tool("get_bot_record", { name: "alphawolf" })).structuredContent).toMatchObject({ bot: { id: "7" } });
    const twins = (await tool("get_bot_record", { name: "Twin" })).structuredContent as { matches: { id: string }[] };
    expect(twins.matches.map((m) => m.id)).toEqual(["8", "9"]);
    expect((await tool("get_bot_record", { bot_id: 404 })).isError).toBe(true);
    expect((await tool("get_bot_record", { name: "Nobody" })).isError).toBe(true);
    expect((await tool("get_bot_record", {})).isError).toBe(true);
  });

  it("get_leaderboard: a board of a season, the current one by default", async () => {
    await start();
    const out = (await tool("get_leaderboard", { board: "top_returns" })).structuredContent as { season: number; entries: { botId: string; rank: number }[] };
    expect(out.season).toBe(1);
    expect(out.entries).toEqual([expect.objectContaining({ botId: "7", rank: 1 })]);
    expect((await tool("get_leaderboard", { board: "best", season: 1 })).isError).toBe(true);
    expect((await tool("get_leaderboard", { board: "most_trusted", season: 9 })).isError).toBe(true);
  });

  it("verify_trade asks the chain, with a checked hash", async () => {
    await start();
    expect((await tool("verify_trade", { tx_hash: TX.toUpperCase().replace("0X", "0x") })).structuredContent).toMatchObject({ valid: true });
    expect(checked).toEqual([TX]);
    expect((await tool("verify_trade", { tx_hash: "0x1234" })).isError).toBe(true);
  });

  it("answers JSON-RPC errors as the spec says", async () => {
    await start();
    expect((await rpc("tools/call", { name: "send_money", arguments: {} })).error?.code).toBe(-32602);
    expect((await rpc("resources/list")).error?.code).toBe(-32601);
    expect(((await (await post({ id: 1, method: "ping" })).json()) as { error: { code: number } }).error.code).toBe(-32600);
    const bad = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(bad.status).toBe(400);
    const batch = (await (await post([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 2, method: "ping" }])).json()) as { id: number }[];
    expect(batch.map((r) => r.id)).toEqual([1, 2]);
    expect((await fetch(url)).status).toBe(405); // no server-sent stream
  });

  it("is limited to 60 requests a minute per address, and 503 when not configured", async () => {
    await start();
    for (let i = 0; i < MCP_PER_IP_PER_MINUTE; i++) expect((await post({ jsonrpc: "2.0", id: i, method: "ping" })).status).toBe(200);
    const limited = await post({ jsonrpc: "2.0", id: 99, method: "ping" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");

    await new Promise<void>((done) => server!.close(() => done()));
    await start({ source: null });
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(503);
  });
});
