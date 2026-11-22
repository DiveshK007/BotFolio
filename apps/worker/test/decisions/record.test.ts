import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { decisionIdFromUuid } from "@botfolio/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashJson } from "../../src/canonical";
import type { DecisionCallResult } from "../../src/decision/call";
import { publicJson, readExact } from "../../src/decisions/json";
import { houseRecord, llmDecision, saveDecision, saveOracleReads, type StoredGateResult } from "../../src/decisions/record";
import { readGateInput } from "../../src/decisions/replay";
import { callsCloseAt, revealOutputHashes } from "../../src/decisions/secrecy";
import { gate } from "../../src/gate/gate";
import type { HouseOutput } from "../../src/house/schema";
import type { Queryable } from "../../src/scheduler/db";
import { buy, decision, gateInput, portfolio, sell } from "../helpers/fixtures";
import { addSlot, llmCall, readings, testDb } from "./helpers";

let pg: PGlite;
let db: Queryable;
beforeEach(async () => ({ pg, db } = await testDb()), 30_000);
afterEach(() => pg.close());

const ist = (time: string) => new Date(`${time}+05:30`);
type TestSlot = Awaited<ReturnType<typeof addSlot>>;

function made(slot: TestSlot, over: Parameters<typeof gateInput>[0] = {}) {
  const id = randomUUID();
  const input = gateInput({ ...over, decisionId: decisionIdFromUuid(id) });
  return { id, version: 1, slot, gateInput: input, readings: readings(), rulesVersion: "gate-v1" };
}

async function row(id: string) {
  const { rows } = await pg.query<{
    input_json: unknown;
    raw: unknown;
    input_hash: string;
    output_hash: string | null;
    gate_result: StoredGateResult;
    reason: string | null;
    status: string;
  }>(
    `select input_json, raw_output_json as raw, '0x' || encode(input_hash, 'hex') as input_hash,
            '0x' || encode(output_hash, 'hex') as output_hash, gate_result, reason, status::text as status
     from decisions where id = $1`,
    [id],
  );
  return rows[0]!;
}

describe("a stored decision is enough to replay it", () => {
  const cases = {
    "a trade and a HOLD": { output: decision(buy("BTC", 20), sell("ETH", 100)), over: { portfolio: portfolio({ ETH: 10 }) } },
    "a clipped buy": { output: decision(buy("GOLD", 100)), over: { bot: { maxPerCoinBps: 2500 } } },
    "a big move": { output: decision(buy("SOL", 40)), over: { bigMove: { buyWeightBps: 3000, sellBps: 5000, ttlMs: 7_200_000 } } },
    "invalid output": { output: { actions: "all in" }, over: {} },
  };

  it.each(Object.entries(cases))("%s", async (_name, { output, over }) => {
    const slot = await addSlot(pg, "2026-11-24T13:00:00");
    const record = llmDecision(made(slot, over), llmCall(output));
    expect(await saveDecision(db, record, slot.time)).toBe(true);

    const stored = await row(record.id);
    const raw = readExact(stored.raw);
    // SPEC §6.5: keccak256 of canonical JSON, recomputable from what is stored.
    expect(stored.input_hash).toBe(hashJson(readExact(stored.input_json)));
    expect(stored.output_hash).toBe(hashJson(raw));

    const { replay, llm, ...result } = stored.gate_result;
    expect(publicJson(gate(readGateInput(replay.input), raw, result.rulesVersion))).toEqual(result);
    expect(replay.rounds.map((r) => r.roundId)).toEqual(["50000", "50001", "50002", "50003", "50004"]);
    expect(llm).toMatchObject({ temperature: 0, attempts: 1, inTok: 1500, outTok: 120 });
  });

  it("a house bot's decision, with no LLM meta", async () => {
    const slot = await addSlot(pg, "2026-11-24T09:00:00");
    const output: HouseOutput = {
      actions: [{ asset: "GOLD", action: "BUY", bps: 5000 }],
      reason: "Gold Granny moved Gold toward 60%, the rest in cash.",
      reason_tag: "rebalance",
      roast: "",
    };
    const record = houseRecord(made(slot, { bot: { isHouse: true } }), output, { strategy: "gold_granny" });
    await saveDecision(db, record, slot.time);

    const stored = await row(record.id);
    const { replay, llm, ...result } = stored.gate_result;
    expect(llm).toBeNull();
    expect(stored.output_hash).toBe(hashJson(output));
    expect(publicJson(gate(readGateInput(replay.input), readExact(stored.raw), "gate-v1"))).toEqual(result);
  });
});

describe("idempotent by bot and slot", () => {
  it("a second decision for the same bot and slot is refused and changes nothing", async () => {
    const slot = await addSlot(pg, "2026-11-24T13:00:00");
    const first = llmDecision(made(slot), llmCall(decision(buy("BTC", 10))));
    const second = llmDecision(made(slot), llmCall(decision(buy("ETH", 10))));
    expect(await saveDecision(db, first, slot.time)).toBe(true);
    expect(await saveDecision(db, second, slot.time)).toBe(false);
    const { rows } = await pg.query<{ id: string }>("select id::text as id from decisions");
    expect(rows).toEqual([{ id: first.id }]);
  });
});

describe("text Postgres can't hold", () => {
  it.each([
    ["NUL", "Going all in\u0000 on gold today"],
    ["a lone surrogate", "Going all in \uD83D on gold today"],
  ])("%s can't fail the write, and the hash still holds", async (_name, reason) => {
    const slot = await addSlot(pg, "2026-11-24T13:00:00");
    const output = { ...decision(), reason };
    const record = llmDecision(made(slot), llmCall(output));
    expect(await saveDecision(db, record, slot.time)).toBe(true);

    const stored = await row(record.id);
    expect(readExact(stored.raw)).toEqual(output);
    expect(stored.output_hash).toBe(hashJson(output));
    expect(stored.reason).toContain("�");
  });

  it("output shaped like our wrapper isn't mistaken for one", async () => {
    const slot = await addSlot(pg, "2026-11-24T13:00:00");
    const output = { $json: "\"gotcha\"" };
    const record = llmDecision(made(slot), llmCall(output));
    await saveDecision(db, record, slot.time);
    expect(readExact((await row(record.id)).raw)).toEqual(output);
  });
});

describe("Daily Call secrecy (SPEC §6.4.1)", () => {
  const VIEWS = [
    { btc_up: true, why: "Momentum" },
    { btc_up: false, why: "guaranteed profit if it dumps" }, // also trips the content filter
  ];

  it.each(["scheduled", "debut"] as const)("two different views leave identical rows for anon (%s)", async (kind) => {
    const slot = await addSlot(pg, kind === "debut" ? "2026-11-24T11:17:00" : "2026-11-24T09:00:00", kind);
    const seen: unknown[] = [];
    for (const [i, view] of VIEWS.entries()) {
      await pg.exec("delete from decisions");
      const base = made(slot);
      const id = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
      const fixed = { ...base, id, gateInput: { ...base.gateInput, decisionId: decisionIdFromUuid(id) } };
      const record = llmDecision(fixed, llmCall({ ...decision(buy("BTC", 10)), daily_call: view }, { daily: true, outTok: 100 + i * 9 }));
      await saveDecision(db, record, slot.time);

      await pg.exec("set role anon");
      // created_at is the clock's, not the decision's.
      seen.push((await pg.query("select to_jsonb(d) - 'created_at' as d from site_decisions d")).rows);
      await pg.exec("reset role");
    }
    expect(seen[1]).toEqual(seen[0]);
    // The key, not the schema's name: "decision_v1_daily_call" says nothing about the answer.
    expect(JSON.stringify(seen)).not.toMatch(/btc_up|"daily_call"|guaranteed/);
  });

  it("the hash appears at the 20:00 cutoff and not a second before", async () => {
    const slot = await addSlot(pg, "2026-11-24T09:00:00");
    const output = { ...decision(), daily_call: VIEWS[0] };
    const record = llmDecision(made(slot), llmCall(output, { daily: true }));
    await saveDecision(db, record, slot.time);

    expect((await row(record.id)).output_hash).toBeNull();
    expect(await revealOutputHashes(db, ist("2026-11-24T19:59:59"))).toBe(0);
    expect((await row(record.id)).output_hash).toBeNull();
    expect(await revealOutputHashes(db, ist("2026-11-24T20:00:00"))).toBe(1);
    expect((await row(record.id)).output_hash).toBe(hashJson(output));
    expect(await revealOutputHashes(db, ist("2026-11-24T21:00:00"))).toBe(0);
  });

  it("a debut after the cutoff has nothing to hold back", async () => {
    const slot = await addSlot(pg, "2026-11-24T21:10:00", "debut");
    const output = { ...decision(), daily_call: VIEWS[0] };
    const record = llmDecision(made(slot), llmCall(output, { daily: true }));
    await saveDecision(db, record, slot.time);
    expect((await row(record.id)).output_hash).toBe(hashJson(output));
  });

  it("a budget hold at 09:00 has no view, so its hash is written at once", async () => {
    const slot = await addSlot(pg, "2026-11-24T09:00:00");
    const call = { ...llmCall(decision()), source: "budget_hold" } as DecisionCallResult;
    const record = llmDecision(made(slot), call);
    await saveDecision(db, record, slot.time);
    const stored = await row(record.id);
    expect(stored.output_hash).not.toBeNull();
    expect(stored.gate_result.llm).toBeNull();
  });

  it("the cutoff is 20:00 IST of the decision's IST day", () => {
    expect(callsCloseAt(ist("2026-11-24T09:00:00"))).toEqual(ist("2026-11-24T20:00:00"));
    expect(callsCloseAt(ist("2026-11-25T00:10:00"))).toEqual(ist("2026-11-25T20:00:00"));
  });
});

describe("saveOracleReads", () => {
  it("keeps the latest valid answer per asset", async () => {
    const slot = await addSlot(pg, "2026-11-24T13:00:00");
    const first = readings();
    await saveOracleReads(db, slot.id, first);
    const retry = first.map((r) =>
      r.asset === "BTC"
        ? { ...r, roundId: "50100", updatedAt: r.updatedAt + 300 }
        : r.asset === "ETH"
          ? { ...r, valid: false, roundId: "0", priceE8: "0", updatedAt: 0 }
          : r,
    );
    await saveOracleReads(db, slot.id, retry);
    const { rows } = await pg.query("select asset::text as asset, round_id::text as round from oracle_reads order by asset");
    expect(rows).toHaveLength(5);
    expect(rows).toContainEqual({ asset: "BTC", round: "50100" });
    expect(rows).toContainEqual({ asset: "ETH", round: "50001" });
  });
});
