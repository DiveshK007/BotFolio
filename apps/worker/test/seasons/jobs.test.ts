import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { HealthState } from "../../src/health";
import type { Db } from "../../src/scheduler/db";
import { createScheduler } from "../../src/scheduler/scheduler";
import { seasonJobs } from "../../src/seasons";
import { systemAccount } from "../../src/system/key";

const key = generatePrivateKey(); // a throwaway
const ENV = { SEASON_LEDGER_ADDRESS: `0x${"12".repeat(20)}`, COMMITTER_PRIVATE_KEY: key };
const log = { info: vi.fn(), warn: vi.fn() };
const db = { withLock: async (_key: string, run: () => Promise<unknown>) => ({ acquired: true, value: await run() }) } as unknown as Db;
const jobs = (env: Record<string, string | undefined>) =>
  seasonJobs({ db, env, client: {} as PublicClient, rpcUrls: ["http://127.0.0.1:1"], log });

describe("seasonJobs", () => {
  it("offers both checks when it is configured", () => {
    const set = jobs(ENV);
    expect(Object.keys(set.handlers).sort()).toEqual(["season_close", "season_open"]);
    expect(set.unavailable).toEqual({});
  });

  it.each([
    ["SEASON_LEDGER_ADDRESS", ""],
    ["SEASON_LEDGER_ADDRESS", `0x${"0".repeat(40)}`],
    ["COMMITTER_PRIVATE_KEY", ""],
    ["COMMITTER_PRIVATE_KEY", "replace-me"],
  ])("doesn't run with %s=%j, and names the variable", (name, value) => {
    const set = jobs({ ...ENV, [name]: value });
    expect(set.handlers).toEqual({});
    expect(set.unavailable.season_open).toContain(name);
    expect(JSON.stringify(set.unavailable)).not.toContain(key.slice(2));
  });

  it.each(["RELAYER_PRIVATE_KEY", "RUNNER_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"])("refuses a committer key shared with %s", (other) => {
    expect(systemAccount({ ...ENV, [other]: key.toUpperCase().replace("0X", "0x") }, "COMMITTER_PRIVATE_KEY")).toBeNull();
  });
});

describe("in the scheduler", () => {
  const health = () => new HealthState({ provider: "fake", capUsd: null });

  it("both checks also run when the worker starts, so a deploy at 00:05 doesn't lose a day", async () => {
    const open = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const scheduler = createScheduler({ db, handlers: { season_open: open, season_close: close }, health: health(), log });
    scheduler.start();
    await vi.waitFor(() => expect(open.mock.calls.length + close.mock.calls.length).toBe(2));
    await scheduler.stop();
  });

  it("a check without config shows in /healthz as not started", async () => {
    const state = health();
    const scheduler = createScheduler({ db, handlers: {}, unavailable: jobs({}).unavailable, health: state, log });
    scheduler.start();
    await scheduler.stop();
    const { jobs: shown, reasons } = state.snapshot();
    expect(shown.season_open!.state).toBe("not_started");
    expect(reasons.join()).toContain("COMMITTER_PRIVATE_KEY");
  });
});
