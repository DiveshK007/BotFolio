import type { PGlite } from "@electric-sql/pglite";
import { estimateCostUsd } from "@botfolio/llm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASSUMED_OUTPUT_TOKENS, monthSpendUsd, monthStart, refreshBudget } from "../../src/budget/spend";
import { HealthState } from "../../src/health";
import type { Queryable } from "../../src/scheduler/db";
import { addSlot, testDb } from "../decisions/helpers";

const MODEL = "grok-4.20-0309-non-reasoning";
const NOW = new Date("2026-11-24T12:00:00Z");

let pg: PGlite;
let db: Queryable;
let n: number;
beforeEach(async () => {
  ({ pg, db } = await testDb());
  n = 0;
}, 30_000);
afterEach(() => pg.close());

async function logged(llm: object | null, at = NOW, model = MODEL) {
  const slot = await addSlot(pg, `2026-11-24T10:${String(n++).padStart(2, "0")}:00`, "debut");
  await pg.query(
    `insert into decisions (bot_id, version, slot_id, prompt_version, model, input_json, input_hash, gate_result, status, created_at)
     values (7, 1, $1, 'prompt-v1', $2, '{}', decode(repeat('00', 32), 'hex'), $3, 'held', $4)`,
    [slot.id, model, JSON.stringify({ llm }), at.toISOString()],
  );
}
const cost = (inTok: number, outTok: number, model = MODEL) => estimateCostUsd(model, { inTok, outTok });

describe("monthSpendUsd", () => {
  it("is zero with nothing logged", async () => {
    expect(await monthSpendUsd(db, NOW)).toBe(0);
  });

  it("adds up the logged tokens, retries included", async () => {
    await logged({ attempts: 1, inTok: 1500, outTok: 120 });
    await logged({ attempts: 2, inTok: 1000, outTok: 100 });
    expect(await monthSpendUsd(db, NOW)).toBeCloseTo(cost(3500, 320), 10);
  });

  it("assumes a high output where the count is withheld for secrecy", async () => {
    await logged({ attempts: 1, inTok: 1500, outTok: null });
    expect(await monthSpendUsd(db, NOW)).toBeCloseTo(cost(1500, ASSUMED_OUTPUT_TOKENS), 10);
  });

  it("charges a failed call for both tries", async () => {
    await logged({ attempts: null, inTok: null, outTok: null });
    expect(await monthSpendUsd(db, NOW)).toBeGreaterThanOrEqual(cost(2000, 2 * ASSUMED_OUTPUT_TOKENS));
  });

  it("charges nothing for house bots and budget holds", async () => {
    await logged(null, NOW, "house-rules");
    await logged(null, NOW, "budget-hold");
    expect(await monthSpendUsd(db, NOW)).toBe(0);
  });

  it("counts this UTC month only", async () => {
    await logged({ attempts: 1, inTok: 9999, outTok: 999 }, new Date("2026-10-31T23:59:59Z"));
    await logged({ attempts: 1, inTok: 100, outTok: 10 }, new Date("2026-11-01T00:00:00Z"));
    expect(await monthSpendUsd(db, NOW)).toBeCloseTo(cost(100, 10), 10);
    expect(monthStart(NOW).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("refreshBudget (SPEC §6.6)", () => {
  const spent = cost(1_000_000, 0);

  it.each([
    ["ok", spent / 0.79],
    ["alert", spent / 0.81],
    ["resting", spent / 1.01],
    ["uncapped", null],
  ] as const)("%s, and a restart doesn't reset it", async (state, capUsd) => {
    await logged({ attempts: 1, inTok: 1_000_000, outTok: 0 });
    const log = { info: vi.fn(), warn: vi.fn() };
    // A new HealthState is what a restarted worker has.
    const health = new HealthState({ provider: "fake", capUsd });
    expect(await refreshBudget(db, health, log, NOW)).toBe(state);
    expect(log.warn).toHaveBeenCalledTimes(state === "alert" || state === "resting" ? 1 : 0);
    const reasons = health.snapshot(NOW).reasons.join();
    if (state === "alert") expect(reasons).toContain("above 80 %");
    if (state === "resting") expect(reasons).toContain("bots resting");
  });
});
