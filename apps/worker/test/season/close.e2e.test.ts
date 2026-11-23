import { FakeLlmClient } from "@botfolio/llm";
import { istDay } from "@botfolio/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadBigMoveConfig, loadWorkerConfig } from "../../src/config";
import { HealthState } from "../../src/health";
import { createChainSource } from "../../src/indexer/chain";
import { CONFIRMATIONS, Indexer } from "../../src/indexer/indexer";
import { readAllFeeds } from "../../src/oracle";
import type { Db } from "../../src/scheduler/db";
import { ensureScheduledSlot } from "../../src/scheduler/slots";
import { closeSeasons, type CloseDeps } from "../../src/season/close";
import type { ReplayStore } from "../../src/season/storage";
import { verifyOffline, verifyOnChain } from "../../src/season/verify";
import { createSeasonChain } from "../../src/seasons/ledger";
import { createRunnerChain } from "../../src/slot/chain";
import { DebutWatcher } from "../../src/slot/debut";
import type { RunnerDeps } from "../../src/slot/deps";
import { runSlot } from "../../src/slot/run";
import { createSystemSender } from "../../src/system/sender";
import { createTestDb, type TestDb } from "../indexer/helpers/db";
import { ACCOUNTS, startFork, type Fork } from "../indexer/helpers/fork";
import { drain, memoryLog } from "../indexer/helpers/world";

// #56's Done-when: the root on-chain equals the replay's.
const fork = await startFork();
const { alice, admin, runner, committer } = ACCOUNTS;

describe.skipIf(!fork)("season close on an Anvil fork", () => {
  let f: Fork;
  let db: TestDb;
  let closeDeps: CloseDeps;
  let indexer: Indexer;
  let uploads: Map<string, string>;
  let chainNow: Date;
  let day: number;
  const signal = new AbortController().signal;

  const at = (dayOffset: number, hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(((day + dayOffset) * 86_400 - 19_800 + h! * 3600 + m! * 60) * 1000);
  };
  const fresh = async (date: Date) => {
    await f.setClock(BigInt(date.getTime() / 1000));
    chainNow = date;
  };
  const index = async () => {
    await f.confirm(CONFIRMATIONS);
    await drain(indexer);
  };

  beforeAll(async () => {
    f = fork!;
    db = await createTestDb();
    day = istDay(Number((await f.client.getBlock()).timestamp)) + 1;
    const { addresses, deployBlock: startBlock, url } = f;
    indexer = new Indexer({ db, sources: [createChainSource(url, addresses)], addresses, startBlock, log: memoryLog() });

    await db.query(
      "insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades, trust_rules_version, status) values (0, $1, $2, 'sprint', 8, 'trust-v1-sprint', 'closing')",
      [at(0, "00:00").toISOString(), at(0, "21:30").toISOString()],
    );
    await fresh(at(0, "00:00"));
    await f.send(committer, "SeasonLedger", "openSeason", [0, BigInt(at(0, "00:00").getTime() / 1000), BigInt(at(0, "21:30").getTime() / 1000)]);

    const cfg = loadWorkerConfig({});
    const llm = new FakeLlmClient((req) => {
      const body = { actions: [{ asset: "BTC", action: "BUY", pct: 10 }], reason: "A little more BTC.", reason_tag: "trend_up", roast: "" };
      return req.schemaName.endsWith("daily_call") ? { ...body, daily_call: { btc_up: true, why: "Up" } } : body;
    });
    const deps: RunnerDeps = {
      db: { ...db, withLock: async (_k, run) => ({ acquired: true, value: await run() }) } as Db,
      chain: createRunnerChain({ client: f.client, registry: addresses.BotRegistry, ledger: addresses.PaperLedger, sender: createSystemSender({ rpcUrls: [url], account: runner }) }),
      readPrices: (now) => readAllFeeds(f.client, cfg.feeds, now),
      llm,
      llmConfig: cfg.llm,
      bigMove: loadBigMoveConfig({}),
      runner,
      paperLedger: addresses.PaperLedger,
      dailyCall: addresses.DailyCall,
      health: new HealthState({ provider: "fake", capUsd: null }),
      log: { info() {}, warn() {} },
      now: () => chainNow,
    };

    await fresh(at(0, "08:00"));
    await f.relay(alice, "BotRegistry", "createBot", [`0x${"a1".repeat(32)}`, 4000, 8]);
    await f.send(admin, "BotRegistry", "createHouseBot", [`0x${"c3".repeat(32)}`, 2500, 8]);
    await new DebutWatcher(deps).tick();
    await db.query("update bots set name = 'Steady Sam' where id = 2");
    for (const hhmm of ["09:00", "13:00", "21:00"]) {
      await fresh(at(0, hhmm));
      await runSlot(deps, { slot: await ensureScheduledSlot(deps.db, chainNow), attempt: 0, signal });
    }
    await index();

    uploads = new Map();
    const store: ReplayStore = {
      put: async (name, text) => {
        uploads.set(`https://storage.example/replay/${name}`, text);
        return `https://storage.example/replay/${name}`;
      },
      get: async (uri) => uploads.get(uri) ?? "",
    };
    const seasons = createSeasonChain({ client: f.client, address: addresses.SeasonLedger, sender: createSystemSender({ rpcUrls: [url], account: committer }) });
    closeDeps = {
      db,
      chain: {
        isClosed: (n) => seasons.isClosed(n),
        closeSeason: (n, root, uri) => seasons.closeSeason(n, root, uri),
        startCashE8: () => deps.chain.startCashE8(),
      },
      store,
      contracts: { chainId: 1990, seasonLedger: addresses.SeasonLedger, paperLedger: addresses.PaperLedger, fromBlock: startBlock.toString() },
      log: { info() {}, warn() {} },
      now: () => at(0, "21:30"),
    };
    await fresh(at(0, "21:31"));
  }, 300_000);

  afterAll(async () => {
    await db?.close();
    fork?.stop();
  });

  it("closes the season on-chain with the uploaded file's root", async () => {
    expect(await closeSeasons(closeDeps, signal)).toEqual([0]);
    const [, , dataRoot, dataURI, closed] = await f.read<[bigint, bigint, string, string, boolean]>("SeasonLedger", "seasons", [0]);
    expect(closed).toBe(true);
    expect(dataURI).toBe("https://storage.example/replay/season-0.jsonl");
    const file = uploads.get(dataURI)!;
    const offline = verifyOffline(file);
    expect(offline.findings).toEqual([]);
    expect(offline.root).toBe(dataRoot);
    expect((await verifyOnChain(f.client, offline)).findings).toEqual([]);
  }, 120_000);

  it("writes results with the battle rank against the house bot", async () => {
    const { rows } = await db.query<{ bot_id: string; battle_rank: number | null; trades: number }>(
      "select bot_id::text, battle_rank, trades from season_results where season_id = 0 order by bot_id",
    );
    expect(rows.map((r) => [r.bot_id, r.battle_rank === null ? null : r.battle_rank > 0])).toEqual([["1", true], ["2", null]]);
    expect(rows[0]!.trades).toBeGreaterThan(0);
  });

  it("the indexer then marks it closed, and a second run sends and uploads nothing", async () => {
    await index();
    const { rows } = await db.query<{ status: string; root_tx: string | null }>("select status::text as status, root_tx from seasons where id = 0");
    expect(rows[0]).toMatchObject({ status: "closed" });
    expect(rows[0]!.root_tx).toMatch(/^0x/);
    await db.query("update seasons set status = 'closing' where id = 0"); // as if the indexer were behind
    uploads.clear();
    expect(await closeSeasons(closeDeps, signal)).toEqual([]);
    expect(uploads.size).toBe(0);
  }, 120_000);

  it("refuses to close when the public file isn't what was uploaded", async () => {
    await db.query(
      "insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades, status) values (1, $1, $2, 'sprint', 8, 'closing')",
      [at(1, "00:00").toISOString(), at(1, "21:30").toISOString()],
    );
    await f.send(committer, "SeasonLedger", "openSeason", [1, BigInt(at(1, "00:00").getTime() / 1000), BigInt(at(1, "21:30").getTime() / 1000)]);
    const tampered = { ...closeDeps, store: { ...closeDeps.store, get: async () => "something else" } };
    await expect(closeSeasons(tampered, signal)).rejects.toThrow("isn't what was uploaded");
    expect(await closeDeps.chain.isClosed(1)).toBe(false);
  }, 120_000);
});
