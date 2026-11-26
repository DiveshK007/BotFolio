import { describe, expect, it } from "vitest";
import { HealthState } from "../../src/health";
import type { Db } from "../../src/scheduler/db";
import { DebutWatcher } from "../../src/slot/debut";
import type { RunnerDeps } from "../../src/slot/deps";

const NOW = new Date("2026-11-27T05:00:00Z");

/** A DB with these bots waiting for their debut, whose slot insert fails. */
function watcher(opts: { nextBotId: () => Promise<bigint>; waiting: string[] }) {
  const health = new HealthState({ provider: "xai", capUsd: null });
  const db = {
    withLock: async (_key: string, run: () => Promise<unknown>) => ({ acquired: true, value: await run() }),
    query: async (text: string) => {
      if (text.includes("insert into slots")) throw new Error("db down");
      if (text.includes("from bots b")) return { rows: opts.waiting.map((id) => ({ id })) };
      return { rows: [] };
    },
  } as unknown as Db;
  const deps = { db, chain: { nextBotId: opts.nextBotId }, health, log: { info() {}, warn() {} }, now: () => NOW };
  return { health, debut: new DebutWatcher(deps as unknown as RunnerDeps) };
}

describe("DebutWatcher health", () => {
  it("a failed debut shows in /healthz", async () => {
    const { health, debut } = watcher({ nextBotId: async () => 1n, waiting: ["5"] });
    await debut.tick();
    expect(health.snapshot(NOW).jobs.debut?.lastRun).toEqual({ at: NOW.toISOString(), problem: "failed" });
    expect(health.snapshot(NOW).reasons).toContain("debut job failed");
  });

  it("a failing poll shows in /healthz, and clears once it works again", async () => {
    let fail = true;
    const { health, debut } = watcher({
      nextBotId: async () => {
        if (fail) throw new Error("rpc down");
        return 1n;
      },
      waiting: [],
    });
    const tick = (debut as unknown as { safeTick(): Promise<void> }).safeTick.bind(debut);
    await tick();
    expect(health.snapshot(NOW).reasons).toContain("debut job poll failed");
    fail = false;
    await tick();
    expect(health.snapshot(NOW).jobs.debut?.lastRun).toEqual({ at: NOW.toISOString() });
  });
});
