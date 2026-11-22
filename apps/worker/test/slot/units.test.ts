import type { PublicClient } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { loadWorkerConfig } from "../../src/config";
import { HealthState } from "../../src/health";
import type { GateOrder } from "../../src/gate/types";
import type { Db } from "../../src/scheduler/db";
import { runnerJobs } from "../../src/slot";
import { batches } from "../../src/slot/deliver";
import { residual } from "../../src/slot/stored";

const order = (botId: bigint, actionIndex: number) => ({ botId, actionIndex }) as GateOrder;

describe("batches", () => {
  it("never splits a bot and keeps its order", () => {
    const orders = [order(1n, 0), order(1n, 1), order(2n, 0), order(2n, 1), order(3n, 0)];
    expect(batches(orders, 3)).toEqual([orders.slice(0, 2), orders.slice(2)]);
  });

  it("gathers a bot's retry orders with its first ones", () => {
    const [a, b, c] = [order(1n, 1), order(2n, 0), order(1n, 0)];
    expect(batches([a, b, c], 10)).toEqual([[a, c, b]]);
  });
});

describe("residual", () => {
  it("keeps every index, so each orderId", () => {
    const output = { actions: [{ action: "BUY" }, { action: "SELL" }, { action: "BUY" }] };
    expect(residual(output, [1])).toEqual({ actions: [{ action: "HOLD" }, { action: "SELL" }, { action: "HOLD" }] });
  });
});

describe("runnerJobs fails closed", () => {
  const ENV: Record<string, string> = {
    BOT_REGISTRY_ADDRESS: `0x${"11".repeat(20)}`,
    PAPER_LEDGER_ADDRESS: `0x${"22".repeat(20)}`,
    DAILY_CALL_ADDRESS: `0x${"33".repeat(20)}`,
    RUNNER_PRIVATE_KEY: generatePrivateKey(), // a throwaway
    XAI_API_KEY: "test-only-not-a-key",
  };
  const jobs = (env: Record<string, string>) =>
    runnerJobs({
      db: {} as Db,
      env,
      cfg: loadWorkerConfig(env),
      client: {} as PublicClient,
      health: new HealthState({ provider: "xai", capUsd: null }),
      log: { info() {}, warn() {} },
    });

  it("runs when configured", () => {
    const set = jobs(ENV);
    expect(set.handlers.slot).toBeTypeOf("function");
    expect(set.service).toBeDefined();
  });

  it.each(Object.keys(ENV))("doesn't run without %s, and names only the variable", (name) => {
    const set = jobs({ ...ENV, [name]: "" });
    expect(set.handlers).toEqual({});
    expect(set.service).toBeUndefined();
    expect(set.unavailable.slot).toBe(`needs ${name}`);
  });

  it("never trades on the fake LLM", () => {
    expect(jobs({ ...ENV, LLM_PROVIDER: "fake" }).unavailable.slot).toContain("LLM_PROVIDER");
  });

  it("refuses an unknown prompt version", () => {
    expect(jobs({ ...ENV, PROMPT_VERSION: "prompt-v9" }).unavailable.slot).toContain("PROMPT_VERSION");
  });
});
