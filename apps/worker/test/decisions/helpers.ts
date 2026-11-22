import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { ASSETS } from "@botfolio/shared";
import type { DecisionCallResult } from "../../src/decision/call";
import type { DecisionInput } from "../../src/decision/input";
import { hashJson } from "../../src/canonical";
import type { OracleReading } from "../../src/oracle";
import type { Queryable } from "../../src/scheduler/db";
import { NOW, PRICE_E8 } from "../helpers/fixtures";

const SCHEMA = readFileSync(new URL("../../../../packages/db/schema.sql", import.meta.url), "utf8");
const ZERO = `\\x${"00".repeat(32)}`;

/** The real schema with the anon role, as on Supabase, and two bots. */
export async function testDb(): Promise<{ pg: PGlite; db: Queryable }> {
  const pg = new PGlite();
  await pg.exec("create role anon nologin; grant usage on schema public to anon;");
  await pg.exec(SCHEMA);
  for (const id of [7, 8]) {
    await pg.query(
      "insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash) values ($1, $2, 'B', 'b', 'p', $3)",
      [id, `0x${String(id).padStart(40, "0")}`, ZERO],
    );
    await pg.query(
      `insert into bot_versions (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source)
       values ($1, 1, 'r', 2500, 4, '{}', $2, 'create')`,
      [id, ZERO],
    );
  }
  const db: Queryable = {
    query: async <Row extends object>(text: string, params?: unknown[]) => ({ rows: (await pg.query<Row>(text, params)).rows }),
  };
  return { pg, db };
}

export async function addSlot(pg: PGlite, ist: string, kind: "scheduled" | "debut" = "scheduled") {
  const time = new Date(`${ist}+05:30`);
  const { rows } = await pg.query<{ id: string }>(
    "insert into slots (slot_time, kind) values ($1, $2) returning id::text as id",
    [time.toISOString(), kind],
  );
  return { id: rows[0]!.id, kind, time };
}

export const readings = (): OracleReading[] =>
  ASSETS.map((asset, i) => ({
    asset: asset.id,
    feed: asset.feed,
    roundId: String(50_000 + i),
    priceE8: PRICE_E8[asset.id].toString(),
    updatedAt: NOW - 60,
    ageSeconds: 60,
    maxAgeSeconds: asset.maxAgeSeconds,
    valid: true,
    fresh: true,
  }));

/** A successful LLM call that returned `output`. */
export function llmCall(output: unknown, opts: { daily?: boolean; outTok?: number } = {}): DecisionCallResult {
  const inputJson = { slot: "2026-11-24T09:00:00+05:30", recent_corrections: [] } as unknown as DecisionInput;
  return {
    status: "ok",
    source: "llm",
    output,
    log: {
      promptVersion: "prompt-v1",
      promptHash: hashJson("prompt"),
      schemaName: opts.daily ? "decision_v1_daily_call" : "decision_v1",
      model: "grok-test",
      temperature: 0,
      attempts: 1,
      usage: { inTok: 1500, outTok: opts.outTok ?? 120 },
      inputJson,
      inputHash: hashJson(inputJson),
      rawOutputJson: output,
      outputHash: hashJson(output),
      error: null,
    },
  } as DecisionCallResult;
}
