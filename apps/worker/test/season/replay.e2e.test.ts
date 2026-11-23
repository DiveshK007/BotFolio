import { FakeLlmClient } from "@botfolio/llm";
import { istDay } from "@botfolio/shared";
import { createTestClient, http, type Hex, type TestClient } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashText } from "../../src/canonical";
import { loadBigMoveConfig, loadWorkerConfig } from "../../src/config";
import { revealOutputHashes } from "../../src/decisions/secrecy";
import { HealthState } from "../../src/health";
import { createChainSource } from "../../src/indexer/chain";
import { CONFIRMATIONS, Indexer } from "../../src/indexer/indexer";
import { readAllFeeds } from "../../src/oracle";
import type { Db } from "../../src/scheduler/db";
import { ensureScheduledSlot } from "../../src/scheduler/slots";
import { buildReplayFile, type ReplayFile } from "../../src/season/replay-file";
import { verifyOffline, verifyOnChain } from "../../src/season/verify";
import { createRunnerChain } from "../../src/slot/chain";
import { DebutWatcher } from "../../src/slot/debut";
import type { RunnerDeps } from "../../src/slot/deps";
import { runSlot } from "../../src/slot/run";
import { createSystemSender } from "../../src/system/sender";
import { createTestDb, type TestDb } from "../indexer/helpers/db";
import { ACCOUNTS, startFork, type Fork } from "../indexer/helpers/fork";
import { drain, memoryLog } from "../indexer/helpers/world";

// #62 and #56's Done-when: the root committed on-chain equals the replay's.
const fork = await startFork();
const { alice, bob, runner, committer } = ACCOUNTS;

describe.skipIf(!fork)("a season's replay file, on an Anvil fork", () => {
  let f: Fork;
  let db: TestDb;
  let file: ReplayFile;
  let chainNow: Date;
  let day: number;
  let warp: TestClient;

  const at = (dayOffset: number, hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(((day + dayOffset) * 86_400 - 19_800 + h! * 3600 + m! * 60) * 1000);
  };
  const fresh = async (date: Date) => {
    await f.setClock(BigInt(date.getTime() / 1000));
    chainNow = date;
  };
  const contracts = () => ({
    chainId: 1990,
    seasonLedger: f.addresses.SeasonLedger,
    paperLedger: f.addresses.PaperLedger,
    fromBlock: f.deployBlock.toString(),
  });

  beforeAll(async () => {
    f = fork!;
    db = await createTestDb();
    warp = createTestClient({ mode: "anvil", transport: http(f.url) });
    day = istDay(Number((await f.client.getBlock()).timestamp)) + 1;
    await db.query(
      "insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades, trust_rules_version) values (0, $1, $2, 'sprint', 8, 'trust-v1-sprint')",
      [at(0, "00:00").toISOString(), at(1, "21:30").toISOString()],
    );
    await fresh(at(0, "00:00"));
    await f.send(committer, "SeasonLedger", "openSeason", [0, BigInt(at(0, "00:00").getTime() / 1000), BigInt(at(1, "21:30").getTime() / 1000)]);

    const cfg = loadWorkerConfig({});
    let n = 0;
    const llm = new FakeLlmClient((req) => {
      const body = {
        actions: [{ asset: ["BTC", "GOLD", "ETH"][n++ % 3], action: "BUY", pct: 10 }],
        reason: "Adding a little of what looks good.",
        reason_tag: "persona_preference",
        roast: "",
      };
      return req.schemaName.endsWith("daily_call") ? { ...body, daily_call: { btc_up: true, why: "Up" } } : body;
    });
    const deps: RunnerDeps = {
      db: { ...db, withLock: async (_k, run) => ({ acquired: true, value: await run() }) } as Db,
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
    const signal = new AbortController().signal;
    const slot = async (time: Date, attempt = 0) => {
      await runSlot(deps, { slot: await ensureScheduledSlot(deps.db, time), attempt, signal });
    };

    await fresh(at(0, "08:00"));
    await f.relay(alice, "BotRegistry", "createBot", [`0x${"a1".repeat(32)}`, 4000, 8]);
    await f.relay(bob, "BotRegistry", "createBot", [`0x${"b2".repeat(32)}`, 5000, 8]);
    await new DebutWatcher(deps).tick();
    await fresh(at(0, "09:00"));
    await slot(at(0, "09:00"));
    // A stale retry: crypto ages past 30 min, then BTC & co. come back at +10.
    await fresh(at(0, "12:20"));
    await warp.setNextBlockTimestamp({ timestamp: BigInt(at(0, "13:00").getTime() / 1000) });
    await warp.mine({ blocks: 1 });
    chainNow = at(0, "13:00");
    await slot(at(0, "13:00"));
    await fresh(at(0, "13:10"));
    await slot(at(0, "13:00"), 2);
    await fresh(at(1, "21:00"));
    await slot(at(1, "21:00"));

    // The indexer writes the trades the file cites.
    const { addresses, deployBlock: startBlock, url } = f;
    const indexer = new Indexer({ db, sources: [createChainSource(url, addresses)], addresses, startBlock, log: memoryLog() });
    await f.confirm(CONFIRMATIONS);
    await drain(indexer);
    await revealOutputHashes(db, at(1, "21:30"));

    file = await buildReplayFile(db, 0, contracts());
    await fresh(at(1, "21:31"));
    await f.send(committer, "SeasonLedger", "closeSeason", [0, file.root, "https://example.invalid/season-0.jsonl"]);
  }, 300_000);

  afterAll(async () => {
    await db?.close();
    fork?.stop();
  });

  it("has the season, every decision, its trades and every mark", () => {
    const types = file.lines.map((line) => (JSON.parse(line) as { type: string }).type);
    expect(types[0]).toBe("season");
    expect(types.filter((t) => t === "decision").length).toBe(8); // 2 debuts + 2 bots × 3 slots
    expect(types.filter((t) => t === "mark").length).toBeGreaterThanOrEqual(6);
    const traded = file.lines.flatMap((l) => (JSON.parse(l) as { trades?: unknown[] }).trades ?? []);
    expect(traded.length).toBeGreaterThan(0);
  });

  it("is built the same way twice", async () => {
    expect((await buildReplayFile(db, 0, contracts())).text).toBe(file.text);
  });

  it("replays offline: canonical lines, hashes and every gate() result, the stale retry included", () => {
    const result = verifyOffline(file.text);
    expect(result.findings).toEqual([]);
    expect(result.root).toBe(file.root);
    const retried = file.lines.some((l) => l.includes('"retries":'));
    expect(retried).toBe(true);
  });

  it("matches QIE: the committed root, each Trade event and oracle round, and the balances", async () => {
    const result = await verifyOnChain(f.client, verifyOffline(file.text));
    expect(result.findings).toEqual([]);
    expect(result.onChainRoot).toBe(file.root);
    expect(result.bots).toBe(2);
    expect(result.trades).toBeGreaterThan(0);
  }, 120_000);

  it("catches a changed line, a forged gate result and a forged price", async () => {
    const lines = file.text.trimEnd().split("\n");
    const i = lines.findIndex((l) => l.includes('"type":"decision"') && l.includes('"trades":[{'));
    const line = JSON.parse(lines[i]!) as Record<string, any>;

    const reason = { ...line, gate_result: { ...line.gate_result, reason: "x" } };
    reason.gate_result.output = { ...line.gate_result.output, reason: "I was always going to win." };
    const forgedGate = replaceLine(lines, i, reason);
    const offline = verifyOffline(forgedGate);
    expect(offline.root).not.toBe(file.root);
    expect(offline.findings.map((x) => x.what).join()).toContain("gate() gives a different result");

    const price = { ...line, trades: [{ ...line.trades[0], price_e8: "1" }, ...line.trades.slice(1)] };
    const forgedPrice = verifyOffline(replaceLine(lines, i, price));
    const chain = await verifyOnChain(f.client, forgedPrice);
    const said = chain.findings.map((x) => x.what).join();
    expect(said).toContain("isn't the file's");
    expect(said).toContain("the event doesn't match the file");
  }, 120_000);

  it("a leaf is keccak256 of the line's text", () => {
    expect(file.leaves[0]).toBe(hashText(file.lines[0]!));
  });
});

const replaceLine = (lines: string[], i: number, value: unknown) =>
  [...lines.slice(0, i), JSON.stringify(sortKeys(value)), ...lines.slice(i + 1)].join("\n");

/** Canonical JSON for the tampered copies, so only the content differs. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]));
  }
  return value as Hex;
}
