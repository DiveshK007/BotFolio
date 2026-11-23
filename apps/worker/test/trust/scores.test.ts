import type { PGlite } from "@electric-sql/pglite";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HealthState } from "../../src/health";
import type { Queryable } from "../../src/scheduler/db";
import { verifyMerkleProof } from "../../src/season/merkle";
import { createWorkerServer } from "../../src/server";
import { TRUST_PROOF_PER_IP_PER_MINUTE, trustRoutes } from "../../src/trust/route";
import { computeTrustScores, saveTrustScores, scoreProof, scoresFile, trustLeaf } from "../../src/trust/scores";
import { testDb } from "../decisions/helpers";

const E8 = 100_000_000n;
const START = 1000n * E8;
const ist = (time: string) => new Date(`${time}+05:30`);

let pg: PGlite;
let db: Queryable;
let ids = 0;

beforeEach(async () => {
  ({ pg, db } = await testDb()); // bots 7 and 8
  await pg.query(
    "insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades, trust_rules_version, status) values (1, $1, $2, 'sprint', 8, 'trust-v1-sprint', 'closing')",
    [ist("2026-11-26T00:00:00").toISOString(), ist("2026-11-28T21:30:00").toISOString()],
  );
  await pg.query(
    "insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades, trust_rules_version) values (2, $1, $2, 'sprint', 8, 'trust-v1-sprint')",
    [ist("2026-11-29T00:00:00").toISOString(), ist("2026-11-30T21:30:00").toISOString()],
  );
}, 30_000);
afterEach(() => pg.close());

async function slot(time: string): Promise<string> {
  const season = ist(time) < ist("2026-11-29T00:00:00") ? 1 : 2;
  const slotTime = ist(time).toISOString();
  await pg.query("insert into slots (slot_time, kind, season_id) values ($1, 'scheduled', $2) on conflict do nothing", [slotTime, season]);
  const { rows } = await pg.query<{ id: string }>("select id::text as id from slots where slot_time = $1 and kind = 'scheduled'", [slotTime]);
  return rows[0]!.id;
}

async function mark(botId: number, time: string, value: bigint) {
  await pg.query("insert into portfolio_marks (bot_id, slot_id, cash_e8, holdings, value_e8) values ($1, $2, 0, '{}', $3)", [botId, await slot(time), value.toString()]);
}

interface Seed {
  gate: object;
  reason: string;
  tag: string;
  input?: object;
  trades?: { asset: string; side: "BUY" | "SELL"; indexed?: boolean }[];
}

async function decision(botId: number, time: string, seed: Seed) {
  const { rows } = await pg.query<{ id: string }>(
    `insert into decisions (bot_id, version, slot_id, prompt_version, model, input_json, input_hash, gate_result, reason, reason_tag, roast, status)
     values ($1, 1, $2, 'prompt-v1', 'm', $3, decode(repeat('00', 32), 'hex'), $4, $5, $6, '', 'executed') returning id::text as id`,
    [botId, await slot(time), JSON.stringify(seed.input ?? {}), JSON.stringify(seed.gate), seed.reason, seed.tag],
  );
  for (const [i, t] of (seed.trades ?? []).entries()) {
    ids++;
    await pg.query(
      `insert into trades (decision_id, action_index, order_id, bot_id, asset, side, cash_e8, units_e18, price_e8, round_id, tx_hash, log_index, block_number)
       values ($1, $2, decode($3, 'hex'), $4, $5, $6, 1, 1, 1, 1, $7, $8, 1)`,
      [rows[0]!.id, i, ids.toString(16).padStart(64, "0"), botId, t.asset, t.side, t.indexed === false ? null : `0x${ids.toString(16).padStart(64, "0")}`, t.indexed === false ? null : ids],
    );
  }
}

async function result(season: number, botId: number) {
  await pg.query(
    "insert into season_results (season_id, bot_id, start_value_e8, end_value_e8, return_bps, max_dd_bps, trades) values ($1, $2, 1, 1, 0, 0, 0)",
    [season, botId],
  );
}

/** Bot 7 has a history; bot 8 only one mark. Both have a season 1 result. */
async function seedHistory() {
  await decision(7, "2026-11-26T09:00:00", {
    gate: { proposedActions: 2, events: [{ kind: "clip", actionIndex: 1, countsForF1: true }] },
    reason: "Buying BTC and a bit of ETH.",
    tag: "trend_up",
    input: { market: [{ asset: "BTC", chg_24h_pct: 1.2 }] },
    trades: [{ asset: "BTC", side: "BUY" }, { asset: "ETH", side: "BUY" }],
  });
  // Stale at first (no penalty), clipped on the retry: one penalty for the action.
  await decision(7, "2026-11-26T13:00:00", {
    gate: {
      proposedActions: 1,
      events: [{ kind: "drop", actionIndex: 0, countsForF1: false }],
      retries: [{ result: { events: [{ kind: "clip", actionIndex: 0, countsForF1: true }] } }],
    },
    reason: "Dip buy on SOL.",
    tag: "buy_dip",
    input: { market: [{ asset: "SOL", chg_24h_pct: -2 }] },
    trades: [{ asset: "SOL", side: "BUY" }],
  });
  await decision(7, "2026-11-26T21:00:00", {
    gate: { proposedActions: 1, events: [] },
    reason: "Taking some profit here.", // names no asset
    tag: "take_profit",
    trades: [{ asset: "BTC", side: "SELL" }],
  });
  // Not yet indexed: proposed, but not executed.
  await decision(7, "2026-11-27T09:00:00", {
    gate: { proposedActions: 1, events: [] },
    reason: "More Gold please.",
    tag: "persona_preference",
    trades: [{ asset: "GOLD", side: "BUY", indexed: false }],
  });
  // After the season's end: none of it counts.
  await decision(7, "2026-11-29T09:00:00", {
    gate: { proposedActions: 3, events: [0, 1, 2].map((actionIndex) => ({ kind: "drop", actionIndex, countsForF1: true })) },
    reason: "x",
    tag: "moon",
    trades: [{ asset: "XRP", side: "BUY" }],
  });

  await mark(7, "2026-11-26T13:00:00", 1005n * E8);
  await mark(7, "2026-11-26T21:00:00", 1010n * E8); // +1 %
  await mark(7, "2026-11-27T21:00:00", 99_990_000_000n); // −1 %: the worst drop, 1 % of the peak
  await mark(7, "2026-11-28T21:00:00", 100_989_900_000n); // +1 %
  await mark(7, "2026-11-29T09:00:00", 500n * E8); // after the end
  await mark(8, "2026-11-27T21:00:00", 1000n * E8);
  await result(1, 7);
  await result(1, 8);
}

describe("computeTrustScores", () => {
  it("scores the whole history up to the season's end", async () => {
    await seedHistory();
    const scores = await computeTrustScores(db, 1, START);
    expect(scores.map((s) => s.botId)).toEqual([7n, 8n]);
    expect(scores[0]).toMatchObject({
      fRules: 150, // 5 proposed, 2 penalised
      fDrawdown: 241, // 1 % → 250 × (1 − 0.01/0.3)
      fConsistency: 191, // σ of [0.01, −0.01, 0.01] = 0.00943
      fExplains: 166, // 2 of 3 executed decisions explained
      total: 748,
      provisional: true, // 4 indexed trades < 8
    });
    // Nothing yet: full marks for rules and drawdown, the middle for consistency, nothing explained.
    expect(scores[1]).toMatchObject({ fRules: 250, fDrawdown: 250, fConsistency: 125, fExplains: 0, total: 625, provisional: true });
    for (const s of scores) expect(s.leaf).toBe(trustLeaf(1, s.botId, s));
  });

  it("is not provisional with enough trades and a completed season", async () => {
    await seedHistory();
    await pg.query("update seasons set provisional_min_trades = 4 where id = 1");
    const [seven, eight] = await computeTrustScores(db, 1, START);
    expect(seven!.provisional).toBe(false);
    expect(eight!.provisional).toBe(true); // no trades
  });

  it("scores nobody when the season has no results", async () => {
    expect(await computeTrustScores(db, 1, START)).toEqual([]);
  });
});

describe("the scores file and proofs", () => {
  it("roots the leaves in bot order, and every stored score proves against it", async () => {
    await seedHistory();
    const scores = await computeTrustScores(db, 1, START);
    await saveTrustScores(db, 1, "trust-v1-sprint", scores);
    await saveTrustScores(db, 1, "trust-v1-sprint", scores); // again: same rows

    const file = scoresFile(1, "trust-v1-sprint", [...scores].reverse());
    const parsed = JSON.parse(file.text) as { root: string; rules_version: string; scores: { bot_id: string; leaf: string }[] };
    expect(parsed).toMatchObject({ root: file.root, rules_version: "trust-v1-sprint" });
    expect(parsed.scores.map((s) => s.bot_id)).toEqual(["7", "8"]);

    const { rows } = await db.query<{ n: number; leaf: string }>(
      "select count(*) over ()::int as n, '0x' || encode(leaf_hash, 'hex') as leaf from trust_scores where season_id = 1 order by bot_id",
    );
    expect(rows.map((r) => r.leaf)).toEqual(parsed.scores.map((s) => s.leaf));
    for (const bot of [7n, 8n]) {
      const p = (await scoreProof(db, 1, bot))!;
      expect(p.root).toBe(file.root);
      expect(p.committedRoot).toBeNull();
      expect(verifyMerkleProof(p.proof, file.root, p.leaf)).toBe(true);
    }
    expect(await scoreProof(db, 1, 9n)).toBeNull();
  });
});

describe("GET /trust/proof", () => {
  let server: Server;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  async function start(routes: Parameters<typeof trustRoutes>[0]) {
    server = createWorkerServer({ health: new HealthState({ provider: "fake", capUsd: null }), routes: trustRoutes(routes) });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/trust/proof`;
  }

  it("serves the score and its proof, and refuses bad or unknown requests", async () => {
    await seedHistory();
    await saveTrustScores(db, 1, "trust-v1-sprint", await computeTrustScores(db, 1, START));
    const url = await start({ db, origins: new Set(["https://botfolio.example"]), clientIp: () => "1.2.3.4" });

    const ok = await fetch(`${url}?season=1&bot=7`, { headers: { origin: "https://botfolio.example" } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://botfolio.example");
    const body = (await ok.json()) as { ok: boolean; score: { botId: string; total: number; proof: string[]; leaf: string; root: string } };
    expect(body.score).toMatchObject({ botId: "7", total: 748, rulesVersion: "trust-v1-sprint" });
    expect(verifyMerkleProof(body.score.proof as `0x${string}`[], body.score.root as `0x${string}`, body.score.leaf as `0x${string}`)).toBe(true);

    expect((await fetch(`${url}?season=1&bot=9`)).status).toBe(404);
    for (const q of ["", "?season=1", "?season=01&bot=7", "?season=1&bot=0", "?season=-1&bot=7", "?season=1&bot=7x"]) {
      expect((await fetch(`${url}${q}`)).status).toBe(400);
    }
  });

  it("is 503 without a database, and throttles one address", async () => {
    let url = await start({ db: null, origins: new Set(), clientIp: () => "1.2.3.4" });
    expect((await fetch(`${url}?season=1&bot=7`)).status).toBe(503);
    await new Promise<void>((done) => server.close(() => done()));

    url = await start({ db, origins: new Set(), clientIp: () => "1.2.3.4", now: () => 0 });
    for (let i = 0; i < TRUST_PROOF_PER_IP_PER_MINUTE; i++) expect((await fetch(`${url}?season=1&bot=7`)).status).toBe(404);
    const limited = await fetch(`${url}?season=1&bot=7`);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });
});
