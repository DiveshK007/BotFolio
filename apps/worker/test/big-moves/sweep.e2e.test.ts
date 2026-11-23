import { FakeLlmClient } from "@botfolio/llm";
import { istDay, type ApprovedOrder } from "@botfolio/shared";
import { createTestClient, http, type Hex, type TestClient } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sweepBigMoves } from "../../src/big-moves/sweep";
import { loadBigMoveConfig, loadWorkerConfig } from "../../src/config";
import { HealthState } from "../../src/health";
import { readAllFeeds } from "../../src/oracle";
import type { Db } from "../../src/scheduler/db";
import { ensureScheduledSlot } from "../../src/scheduler/slots";
import { createRunnerChain } from "../../src/slot/chain";
import { DebutWatcher } from "../../src/slot/debut";
import type { RunnerDeps } from "../../src/slot/deps";
import { runSlot } from "../../src/slot/run";
import { createSystemSender } from "../../src/system/sender";
import { createTestDb, type TestDb } from "../indexer/helpers/db";
import { ACCOUNTS, startFork, type Fork } from "../indexer/helpers/fork";

// #53: an expired big move executes once, clipped, under the same orderId, only once block.timestamp > deadline.
const fork = await startFork();
const { alice, bob, runner } = ACCOUNTS;
const HOUR = 3600;

describe.skipIf(!fork)("big-move expiry sweep on an Anvil fork", () => {
  let f: Fork;
  let db: TestDb;
  let deps: RunnerDeps;
  let warp: TestClient;
  let chainNow: Date;
  let day: number;
  let wants: Record<string, object>;
  const signal = new AbortController().signal;

  const at = (offsetSeconds: number) => new Date(((day * 86_400) - 19_800 + offsetSeconds) * 1000);
  const fresh = async (date: Date) => {
    await f.setClock(BigInt(date.getTime() / 1000));
    chainNow = date;
  };
  const units = async (botId: bigint) => await f.read<readonly bigint[]>("PaperLedger", "holdings", [botId]);
  const move = async (botId: number) =>
    (
      await db.query<{ status: string; bps: number; idx: number; sig: string; deadline: string; decision: string; order_id: string }>(
        `select status::text as status, bps, action_index as idx, encode(runner_sig, 'hex') as sig,
                extract(epoch from deadline)::bigint::text as deadline, decision_id::text as decision,
                '0x' || encode(order_id, 'hex') as order_id
         from big_moves where bot_id = $1`,
        [botId],
      )
    ).rows[0]!;
  const runnerTxs = () => f.client.getTransactionCount({ address: runner.address });

  beforeAll(async () => {
    f = fork!;
    db = await createTestDb();
    warp = createTestClient({ mode: "anvil", transport: http(f.url) });
    day = istDay(Number((await f.client.getBlock()).timestamp)) + 1;
    wants = {};
    const llm = new FakeLlmClient((req) => {
      const name = (req.input as { bot: { name: string } }).bot.name;
      const body = { actions: [], reason: "Waiting for the right moment.", reason_tag: "stay_cash", roast: "", ...wants[name] };
      return req.schemaName.endsWith("daily_call") ? { ...body, daily_call: { btc_up: true, why: "Up" } } : body;
    });
    const cfg = loadWorkerConfig({});
    const jobDb: Db = { ...db, withLock: async (_key, run) => ({ acquired: true, value: await run() }) };
    deps = {
      db: jobDb,
      chain: createRunnerChain({
        client: f.client,
        registry: f.addresses.BotRegistry,
        ledger: f.addresses.PaperLedger,
        sender: createSystemSender({ rpcUrls: [f.url], account: runner }),
      }),
      readPrices: (now) => readAllFeeds(f.client, cfg.feeds, now),
      llm,
      llmConfig: cfg.llm,
      bigMove: loadBigMoveConfig({}),
      runner,
      paperLedger: f.addresses.PaperLedger,
      dailyCall: f.addresses.DailyCall,
      health: new HealthState({ provider: "fake", capUsd: null }),
      log: { info() {}, warn() {} },
      now: () => chainNow,
    };

    // Alice and Bob each get a bot whose 13:00 decision is a 45 % SOL buy: a big move.
    await fresh(at(10 * HOUR));
    await f.relay(alice, "BotRegistry", "createBot", [`0x${"a1".repeat(32)}`, 5000, 8]);
    await f.relay(bob, "BotRegistry", "createBot", [`0x${"b2".repeat(32)}`, 5000, 8]);
    await new DebutWatcher(deps).tick(); // their rows; the debuts hold
    wants = { "Bot #1": { actions: [{ asset: "SOL", action: "BUY", pct: 45 }] }, "Bot #2": { actions: [{ asset: "SOL", action: "BUY", pct: 45 }] } };
    await fresh(at(13 * HOUR));
    await runSlot(deps, { slot: await ensureScheduledSlot(deps.db, chainNow), attempt: 0, signal });
  }, 180_000);

  afterAll(async () => {
    await db?.close();
    fork?.stop();
  });

  it("the slot made two pending big moves and traded neither", async () => {
    expect((await move(1)).status).toBe("pending");
    expect((await move(2)).status).toBe("pending");
    expect((await units(1n))[2]).toBe(0n);
    expect((await units(2n))[2]).toBe(0n);
  });

  it("does nothing before the deadline, by the chain's clock", async () => {
    const deadline = Number((await move(1)).deadline);
    await fresh(new Date((deadline - 120) * 1000));
    const txs = await runnerTxs();
    expect(await sweepBigMoves(deps, signal)).toEqual({ shrunk: 0, expired: 0 });
    expect(await runnerTxs()).toBe(txs);
  }, 60_000);

  it("Alice allows hers in time, so the sweep sends nothing for it", async () => {
    const m = await move(1); // the chain is 2 min before the deadline
    const order: ApprovedOrder = {
      botId: 1n,
      asset: 2,
      buy: true,
      bps: m.bps,
      decisionId: `0x${m.decision.replaceAll("-", "").padStart(64, "0")}`,
      actionIndex: m.idx,
      deadline: BigInt(m.deadline),
    };
    await f.relay(alice, "PaperLedger", "executeApproved", [order, `0x${m.sig}`]);
    expect((await units(1n))[2]).toBeGreaterThan(0n);
  }, 60_000);

  it("at the deadline itself the sweep still waits: executeApproved accepts block.timestamp == deadline", async () => {
    const deadline = Number((await move(2)).deadline);
    await fresh(new Date(deadline * 1000));
    expect(await sweepBigMoves(deps, signal)).toEqual({ shrunk: 0, expired: 0 });
    expect((await move(2)).status).toBe("pending");
  }, 60_000);

  it("after the deadline Bob's executes once, clipped under the threshold, and Alice's is marked approved", async () => {
    await fresh(new Date((Number((await move(2)).deadline) + 60) * 1000));
    const before = await units(1n);
    expect(await sweepBigMoves(deps, signal)).toEqual({ shrunk: 1, expired: 0 });

    expect((await move(1)).status).toBe("approved");
    expect(await units(1n)).toEqual(before);
    expect((await move(2)).status).toBe("shrunk");

    const held = (await units(2n))[2]!;
    expect(held).toBeGreaterThan(0n);
    const [, solPrice] = await f.client.readContract({
      address: "0xe86999c8e6C8eeF71bebd35286bCa674E0AD7b21",
      abi: [{ type: "function", name: "latestRoundData", stateMutability: "view", inputs: [], outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }] }],
      functionName: "latestRoundData",
    });
    const value = await f.read<bigint>("PaperLedger", "portfolioValueE8", [2n]);
    const weightBps = ((held * solPrice) / 10n ** 18n) * 10_000n / value;
    expect(weightBps).toBeLessThan(3000n);
    expect(weightBps).toBeGreaterThan(2900n);
    expect(await f.read<boolean>("PaperLedger", "usedOrder", [(await move(2)).order_id as Hex])).toBe(true);
  }, 60_000);

  it("a second sweep sends nothing", async () => {
    const txs = await runnerTxs();
    expect(await sweepBigMoves(deps, signal)).toEqual({ shrunk: 0, expired: 0 });
    expect(await runnerTxs()).toBe(txs);
  }, 60_000);

  it("the shrink is in the decision's gate_result, enough to recompute it", async () => {
    const { decision } = await move(2);
    const { rows } = await db.query<{ shrinks: { orderId: string; order: { bps: number }; input: object }[] }>(
      "select gate_result -> 'shrinks' as shrinks from decisions where id = $1",
      [decision],
    );
    expect(rows[0]!.shrinks).toHaveLength(1);
    expect(rows[0]!.shrinks[0]).toMatchObject({ orderId: (await move(2)).order_id, input: expect.any(Object) });
    expect(rows[0]!.shrinks[0]!.order.bps).toBeLessThan(4500);
  });
});
