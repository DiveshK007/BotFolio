import { FakeLlmClient } from "@botfolio/llm";
import { istDay, type ApprovedOrder } from "@botfolio/shared";
import { createTestClient, http, type Hex, type TestClient } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

// The first-trade path of #47 on real contracts: real forwarder, real runner key, scripted LLM.
const fork = await startFork();
const { alice, bob, admin, runner } = ACCOUNTS;

type Reply = { actions: object[]; reason: string; reason_tag: string; roast: string };
const reply = (...actions: [string, "BUY" | "SELL", number][]): Reply => ({
  actions: actions.map(([asset, action, pct]) => ({ asset, action, pct })),
  reason: "Moving a little into what the owner likes.",
  reason_tag: "persona_preference",
  roast: "",
});

describe.skipIf(!fork)("slot runner and debut on an Anvil fork", () => {
  let f: Fork;
  let db: TestDb;
  let deps: RunnerDeps;
  let llm: FakeLlmClient;
  let warp: TestClient;
  let script: Record<string, Reply>;
  let chainNow: Date;
  let day: number;
  const lines: string[] = [];

  const at = (dayOffset: number, hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(((day + dayOffset) * 86_400 - 19_800 + h! * 3600 + m! * 60) * 1000);
  };
  const seconds = (date: Date) => BigInt(date.getTime() / 1000);
  /** Time moves and every feed has a round from then. */
  async function fresh(date: Date) {
    await f.setClock(seconds(date));
    chainNow = date;
  }
  /** Time moves and no feed updates: after 40 min crypto is too old and Gold (6 h) isn't. */
  async function age(date: Date) {
    await warp.setNextBlockTimestamp({ timestamp: seconds(date) });
    await warp.mine({ blocks: 1 });
    chainNow = date;
  }
  const units = async (botId: bigint) => await f.read<readonly bigint[]>("PaperLedger", "holdings", [botId]);
  const runnerTxs = () => f.client.getTransactionCount({ address: runner.address });
  const signal = new AbortController().signal;
  const slotRun = async (time: Date, attempt = 0) => runSlot(deps, { slot: await ensureScheduledSlot(deps.db, time), attempt, signal });
  const one = async <T extends object>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;

  beforeAll(async () => {
    f = fork!;
    db = await createTestDb();
    warp = createTestClient({ mode: "anvil", transport: http(f.url) });
    day = istDay(Number((await f.client.getBlock()).timestamp)) + 1;

    script = {};
    llm = new FakeLlmClient((req) => {
      const name = (req.input as { bot: { name: string } }).bot.name;
      const body = script[name] ?? reply();
      return req.schemaName.endsWith("daily_call") ? { ...body, daily_call: { btc_up: false, why: "Looks heavy" } } : body;
    });

    const cfg = loadWorkerConfig({});
    const log = {
      info: (event: string, fields?: object) => void lines.push(event + JSON.stringify(fields, (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v))),
      warn: (event: string, fields?: object) => void lines.push(event + JSON.stringify(fields, (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v))),
    };
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
      log,
      now: () => chainNow,
    };
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    fork?.stop();
  });

  it("createBot → debut trade, with the owner's persona draft, before any indexer ran", async () => {
    await fresh(at(0, "10:00"));
    const personaHash: Hex = `0x${"a1".repeat(32)}`;
    const draft = { personas: { [personaHash]: { name: "AlphaWolf", emoji: "🐺", persona: "Bold.", rules: "Buys strength." } } };
    await db.query("insert into users (wallet_address, terms_accepted_at, flags) values ($1, now(), $2)", [
      alice.address.toLowerCase(),
      JSON.stringify(draft),
    ]);
    await f.relay(alice, "BotRegistry", "createBot", [personaHash, 4000, 8]);
    script.AlphaWolf = reply(["BTC", "BUY", 20]);

    await new DebutWatcher(deps).tick();

    expect((await units(1n))[0]).toBeGreaterThan(0n);
    const row = await one<{ name: string; tx: string | null; kind: string; status: string; hash: unknown }>(
      `select b.name, b.created_tx as tx, s.kind::text as kind, d.status::text as status, d.output_hash as hash
       from decisions d join bots b on b.id = d.bot_id join slots s on s.id = d.slot_id`,
    );
    // Pending until indexed, and the hash waits for 20:00 because this decision has a Daily Call view.
    expect(row).toEqual({ name: "AlphaWolf", tx: null, kind: "debut", status: "executed", hash: null });
  }, 60_000);

  it("a second poll, or a restarted watcher, neither asks the LLM nor sends again", async () => {
    const [calls, txs] = [llm.calls.length, await runnerTxs()];
    await new DebutWatcher(deps).tick();
    await new DebutWatcher(deps).tick();
    expect(llm.calls.length).toBe(calls);
    expect(await runnerTxs()).toBe(txs);
  }, 60_000);

  it("the debut's signed view is one the real DailyCall accepts", async () => {
    const view = await one<{ up: boolean; sig: string }>("select bot_up as up, encode(bot_up_sig, 'hex') as sig from daily_calls");
    await f.relay(alice, "DailyCall", "call", [1n, true, view.up, `0x${view.sig}`]);
    expect(view.up).toBe(false);
    expect(lines.join()).not.toMatch(/btc_up|Looks heavy/);
  }, 60_000);

  it("a slot trades what is fresh and holds what is stale", async () => {
    await fresh(at(0, "12:20"));
    await age(at(0, "13:00")); // crypto is 40 min old, Gold is fine
    script.AlphaWolf = reply(["ETH", "BUY", 10], ["GOLD", "BUY", 10]);

    expect(await slotRun(at(0, "13:00"))).toEqual({ failed: 0 });
    const held = await units(1n);
    expect(held[4]).toBeGreaterThan(0n);
    expect(held[1]).toBe(0n);
  }, 60_000);

  it("the same slot again changes nothing", async () => {
    const [calls, txs, held] = [llm.calls.length, await runnerTxs(), await units(1n)];
    expect(await slotRun(at(0, "13:00"))).toEqual({ failed: 0 });
    expect(await slotRun(at(0, "13:00"), 1)).toEqual({ failed: 0 }); // still stale
    expect(llm.calls.length).toBe(calls);
    expect(await runnerTxs()).toBe(txs);
    expect(await units(1n)).toEqual(held);
  }, 60_000);

  it("+10 min: the stale action trades under the same decision, without another LLM call", async () => {
    await fresh(at(0, "13:10"));
    const calls = llm.calls.length;
    expect(await slotRun(at(0, "13:00"), 2)).toEqual({ failed: 0 });
    expect((await units(1n))[1]).toBeGreaterThan(0n);
    expect(llm.calls.length).toBe(calls);

    const txs = await runnerTxs();
    await slotRun(at(0, "13:00"), 2);
    await slotRun(at(0, "13:00"), 3);
    expect(await runnerTxs()).toBe(txs);

    const { n } = await one<{ n: number }>(
      "select count(*)::int as n from decisions d join slots s on s.id = d.slot_id where s.kind = 'scheduled'",
    );
    expect(n).toBe(1);
  }, 60_000);

  it("a big move isn't sent; the owner's Allow with the stored signature executes it", async () => {
    await fresh(at(0, "17:00"));
    script.AlphaWolf = reply(["SOL", "BUY", 60]);
    await slotRun(at(0, "17:00"));
    expect((await units(1n))[2]).toBe(0n);

    const m = await one<{ bps: number; idx: number; sig: string; deadline: string; decision: string }>(
      `select bps, action_index as idx, encode(runner_sig, 'hex') as sig,
              extract(epoch from deadline)::bigint::text as deadline, decision_id::text as decision
       from big_moves`,
    );
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

  it("a mark is written for every slot", async () => {
    const { n } = await one<{ n: number }>("select count(*)::int as n from portfolio_marks");
    expect(n).toBe(3); // debut, 13:00, 17:00
  });

  it("one bot's failure doesn't stop the others", async () => {
    await f.send(admin, "BotRegistry", "createHouseBot", [`0x${"c3".repeat(32)}`, 5000, 8]);
    await new DebutWatcher(deps).tick(); // writes its row. House bots have no debut.
    await fresh(at(0, "21:00"));
    script.AlphaWolf = reply(["XRP", "BUY", 10]);
    expect(await slotRun(at(0, "21:00"))).toEqual({ failed: 1 }); // no such house bot: "Bot #2"
    expect((await units(1n))[3]).toBeGreaterThan(0n);
  }, 60_000);

  it("Steady Sam's stale retry still lands on 20 % in each", async () => {
    await f.send(admin, "BotRegistry", "createHouseBot", [`0x${"d4".repeat(32)}`, 2500, 8]);
    chainNow = new Date(Number((await f.client.getBlock()).timestamp) * 1000);
    await new DebutWatcher(deps).tick();
    await db.query("update bots set name = 'Steady Sam' where id = 3");
    await db.query(
      `insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades)
       values (0, $1, $2, 'sprint', 8)`,
      [at(1, "00:00").toISOString(), at(2, "21:30").toISOString()],
    );
    script.AlphaWolf = reply();

    await fresh(at(1, "08:20"));
    await age(at(1, "09:00"));
    await slotRun(at(1, "09:00"));
    const first = await units(3n);
    expect(first[4]).toBeGreaterThan(0n);
    expect(first[0]).toBe(0n);

    await fresh(at(1, "09:05"));
    await slotRun(at(1, "09:00"), 1);
    const held = await units(3n);
    const readings = await deps.readPrices(Math.floor(chainNow.getTime() / 1000));
    const value = await f.read<bigint>("PaperLedger", "portfolioValueE8", [3n]);
    for (const [i, reading] of readings.entries()) {
      const weight = Number(((held[i]! * BigInt(reading.priceE8)) / 10n ** 18n) * 10_000n / value);
      expect(weight, reading.asset).toBeGreaterThanOrEqual(1990);
      expect(weight, reading.asset).toBeLessThanOrEqual(2000);
    }
  }, 60_000);

  it("with the budget used up it holds, and doesn't call the LLM", async () => {
    await fresh(at(1, "13:00"));
    const calls = llm.calls.length;
    const resting = { ...deps, health: new HealthState({ provider: "fake", capUsd: 0 }) };
    await runSlot(resting, { slot: await ensureScheduledSlot(deps.db, at(1, "13:00")), attempt: 0, signal });
    expect(llm.calls.length).toBe(calls);
    const row = await one<{ model: string; status: string }>(
      "select model, status::text as status from decisions where bot_id = 1 order by slot_id desc limit 1",
    );
    expect(row).toEqual({ model: "budget-hold", status: "held" });
  }, 60_000);

  it("a user who creates a bot while the worker is down still gets a debut inside 10 minutes", async () => {
    await fresh(at(1, "14:00"));
    await f.relay(bob, "BotRegistry", "createBot", [`0x${"b2".repeat(32)}`, 5000, 4]);
    await fresh(at(1, "14:08"));
    script["Bot #4"] = reply(["BTC", "BUY", 10]);
    await new DebutWatcher(deps).tick();
    expect((await units(4n))[0]).toBeGreaterThan(0n);
  }, 60_000);
});
