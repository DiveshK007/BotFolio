import type { PGlite } from "@electric-sql/pglite";
import { FakeLlmClient } from "@botfolio/llm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashJson } from "../../src/canonical";
import type { Queryable } from "../../src/scheduler/db";
import { proposeVersions, type V2Deps } from "../../src/v2/job";
import { addSlot, testDb } from "../decisions/helpers";

const ist = (time: string) => new Date(`${time}+05:30`);
const signal = new AbortController().signal;
const config = { models: { decision: "m", persona: "m", v2: "v2-model" }, temperature: 0, timeoutMs: 1000 };

let pg: PGlite;
let db: Queryable;
let llm: FakeLlmClient;
let clock: Date;

const deps = (): V2Deps => ({ db, llm, llmConfig: config, resting: () => false, log: { info() {}, warn() {} }, now: () => clock });

async function season(id: number, opens: string, closes: string) {
  await pg.query("insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades, status) values ($1, $2, $3, 'sprint', 8, 'closed')", [id, ist(opens), ist(closes)]);
  for (const bot of [7, 8, 90]) {
    await pg.query(
      "insert into season_results (season_id, bot_id, start_value_e8, end_value_e8, return_bps, max_dd_bps, trades, battle_rank) values ($1, $2, 1, 1, -200, 1200, 5, 2)",
      [id, bot],
    );
  }
}

let n = 0;
async function correction(botId: number, at: string, chip: string, indexed = true): Promise<number> {
  const slot = await addSlot(pg, at);
  const { rows: d } = await pg.query<{ id: string }>(
    `insert into decisions (bot_id, version, slot_id, prompt_version, model, input_json, input_hash, status)
     values ($1, 1, $2, 'p', 'm', '{}', decode(repeat('00', 32), 'hex'), 'held') returning id::text as id`,
    [botId, slot.id],
  );
  n++;
  const { rows } = await pg.query<{ id: number }>(
    `insert into corrections (bot_id, decision_id, user_wallet, chip, note, tx_hash, created_at)
     values ($1, $2, '0x${"0".repeat(39)}7', $3, 'a note', $4, $5) returning id::int as id`,
    [botId, d[0]!.id, chip, indexed ? `0x${n.toString(16).padStart(64, "0")}` : null, ist(at)],
  );
  return rows[0]!.id;
}

async function versions(botId: number) {
  const { rows } = await pg.query<{ version: number; committed: boolean; config_json: Record<string, unknown> | null; hash: string; coin: number }>(
    `select version, committed_tx is not null as committed, config_json, '0x' || encode(config_hash, 'hex') as hash, max_per_coin_bps as coin
     from bot_versions where bot_id = $1 order by version`,
    [botId],
  );
  return rows;
}

beforeEach(async () => {
  ({ pg, db } = await testDb()); // bots 7 and 8, version 1 each
  await pg.exec(`
    insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash, is_house)
    values (90, '0x${"9".repeat(40)}', 'Steady Sam', 's', '', decode(repeat('00', 32), 'hex'), true);
    insert into bot_versions (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source)
    values (90, 1, 'r', 2000, 1, '{}', decode(repeat('00', 32), 'hex'), 'create');
    update bots set status = 'paused' where id = 8;`);
  await season(1, "2026-11-26T00:00:00", "2026-11-27T21:30:00");
  llm = new FakeLlmClient((req) => {
    const ids = (req.input as { corrections: { id: number }[] }).corrections.map((c) => c.id);
    return {
      rules: "Smaller bites.",
      max_per_coin_pct: 15,
      max_trades_per_day: 3,
      changes: [{ what: "You said 'too risky' → max per coin 25 % → 15 %", because_correction_id: ids[0] ?? 0 }],
    };
  });
  clock = ist("2026-11-27T21:45:00");
}, 30_000);
afterEach(() => pg.close());

describe("proposeVersions (#57)", () => {
  it("proposes for each active raised bot, from this season's indexed corrections", async () => {
    const inSeason = await correction(7, "2026-11-26T13:00:00", "too risky");
    await correction(7, "2026-11-25T13:00:00", "too timid"); // before the season
    await correction(7, "2026-11-27T09:00:00", "too timid", false); // not indexed yet

    expect(await proposeVersions(deps(), signal)).toBe(1);
    expect(llm.calls).toHaveLength(1); // not the paused bot, not the house bot
    expect((llm.calls[0]!.input as { corrections: { id: number }[] }).corrections.map((c) => c.id)).toEqual([inSeason]);

    const [v1, v2] = await versions(7);
    expect(v1).toMatchObject({ version: 1 });
    expect(v2).toMatchObject({ version: 2, committed: false, coin: 1500 });
    expect(v2!.config_json).toMatchObject({ season: 1, version: 2, changes: [{ because_correction_id: inSeason }], approve_by: ist("2026-11-28T08:30:00").toISOString() });
    // The row hashes to the hash the owner will commit.
    expect(hashJson(v2!.config_json)).toBe(v2!.hash);
    expect(await versions(8)).toHaveLength(1);
    expect(await versions(90)).toHaveLength(1);
  });

  it("runs once per season, replaces an older unapproved proposal, and never touches a committed one", async () => {
    await proposeVersions(deps(), signal);
    expect(await proposeVersions(deps(), signal)).toBe(0);
    expect(llm.calls).toHaveLength(1);

    // Season 2: the season 1 proposal was never approved, so it is replaced.
    await season(2, "2026-11-28T00:00:00", "2026-11-29T21:30:00");
    clock = ist("2026-11-29T21:45:00");
    expect(await proposeVersions(deps(), signal)).toBe(1);
    let rows = await versions(7);
    expect(rows.map((r) => [r.version, r.config_json?.season])).toEqual([[1, undefined], [2, 2]]);

    // The owner approves it; season 3 proposes version 3 and leaves version 2 alone.
    await pg.query(`update bot_versions set committed_tx = '0x${"ab".repeat(32)}' where bot_id = 7 and version = 2`);
    const before = rows[1]!.hash;
    await season(3, "2026-11-30T00:00:00", "2026-12-01T21:30:00");
    clock = ist("2026-12-01T21:45:00");
    expect(await proposeVersions(deps(), signal)).toBe(1);
    rows = await versions(7);
    expect(rows.map((r) => [r.version, r.committed])).toEqual([[1, false], [2, true], [3, false]]);
    expect(rows[1]!.hash).toBe(before);
    expect(rows[2]!.config_json).toMatchObject({ from: { version: 2, max_per_coin_bps: 1500 } });
  });

  it("proposes nothing after 08:30 the next morning", async () => {
    clock = ist("2026-11-28T08:31:00");
    expect(await proposeVersions(deps(), signal)).toBe(0);
  });

  it("still proposes without an LLM, from the fallback", async () => {
    expect(await proposeVersions({ ...deps(), llm: null }, signal)).toBe(1);
    const [, v2] = await versions(7);
    expect(v2!.config_json).toMatchObject({ proposed_by: { model: "fallback" }, max_per_coin_bps: 2000 });
  });
});
