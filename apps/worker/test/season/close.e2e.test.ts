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
import { challengeWinner, createChallengeChain } from "../../src/season/challenges";
import { createTrustRegistryChain } from "../../src/trust/registry";
import { scoreProof } from "../../src/trust/scores";
import { keccak256, stringToHex, toHex, zeroHash, type Hex } from "viem";
import { createTestDb, type TestDb } from "../indexer/helpers/db";
import { ACCOUNTS, startFork, type Fork } from "../indexer/helpers/fork";
import { drain, memoryLog } from "../indexer/helpers/world";

// #56's Done-when: the root on-chain equals the replay's.
const fork = await startFork();
const { alice, bob, admin, runner, committer } = ACCOUNTS;

describe.skipIf(!fork)("season close on an Anvil fork", () => {
  let f: Fork;
  let db: TestDb;
  let closeDeps: CloseDeps;
  let indexer: Indexer;
  let uploads: Map<string, string>;
  let llm: FakeLlmClient;
  let chainNow: Date;
  let day: number;
  const warnings: string[] = [];
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
    llm = new FakeLlmClient((req) => {
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
    await f.relay(bob, "BotRegistry", "createBot", [`0x${"b2".repeat(32)}`, 4000, 8]);
    await new DebutWatcher(deps).tick();
    await db.query("update bots set name = 'Steady Sam' where id = 2");

    // #61: Bob's bot (3) takes Alice's challenge; her second one is never accepted.
    await f.relay(alice, "Challenges", "create", [1n, 0]);
    await index();
    const { rows: created } = await db.query<{ code: Hex }>("select code from challenges");
    await f.relay(bob, "Challenges", "accept", [created[0]!.code, 3n]);
    await f.relay(alice, "Challenges", "create", [1n, 0]);
    const slot = async (hhmm: string) => {
      await fresh(at(0, hhmm));
      await runSlot(deps, { slot: await ensureScheduledSlot(deps.db, chainNow), attempt: 0, signal });
    };
    await slot("09:00");
    await slot("13:00");

    // #51: Alice corrects her 09:00 call. The app's pending row holds the note; the indexer confirms it.
    const { rows: nine } = await db.query<{ id: string }>(
      "select d.id::text as id from decisions d join slots s on s.id = d.slot_id where d.bot_id = 1 and s.slot_time = $1",
      [at(0, "09:00").toISOString()],
    );
    const note = "stop going all in";
    const noteHash = keccak256(toHex(note));
    await db.query(
      "insert into corrections (bot_id, decision_id, user_wallet, chip, note, note_hash) values (1, $1, $2, 'too risky', $3, decode($4, 'hex'))",
      [nine[0]!.id, alice.address.toLowerCase(), note, noteHash.slice(2)],
    );
    const decisionId = `0x${"0".repeat(32)}${nine[0]!.id.replaceAll("-", "")}` as Hex;
    await f.relay(alice, "SeasonLedger", "recordCorrection", [1n, decisionId, noteHash, 0]);
    await index();

    await slot("21:00");
    await index();

    uploads = new Map();
    const store: ReplayStore = {
      put: async (name, text) => {
        uploads.set(`https://storage.example/replay/${name}`, text);
        return `https://storage.example/replay/${name}`;
      },
      get: async (uri) => uploads.get(uri) ?? "",
    };
    const sender = createSystemSender({ rpcUrls: [url], account: committer });
    const seasons = createSeasonChain({ client: f.client, address: addresses.SeasonLedger, sender });
    const trust = createTrustRegistryChain({ client: f.client, address: addresses.TrustScoreRegistry, sender });
    const challenges = createChallengeChain({ client: f.client, address: addresses.Challenges, sender });
    closeDeps = {
      db,
      chain: {
        isClosed: (n) => seasons.isClosed(n),
        closeSeason: (n, root, uri) => seasons.closeSeason(n, root, uri),
        startCashE8: () => deps.chain.startCashE8(),
        scoresRoot: (n) => trust.scoresRoot(n),
        rulesPublished: (version) => trust.rulesPublished(version),
        commitScores: (n, version, root, uri) => trust.commitScores(n, version, root, uri),
        challenge: (code) => challenges.challenge(code),
        settleChallenge: (code, winner) => challenges.settleChallenge(code, winner),
        expireChallenge: (code) => challenges.expireChallenge(code),
      },
      store,
      contracts: { chainId: 1990, seasonLedger: addresses.SeasonLedger, paperLedger: addresses.PaperLedger, fromBlock: startBlock.toString() },
      log: { info() {}, warn: (event: string) => void warnings.push(event) },
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

    // The rules weren't published yet: the scores are saved but wait, and the data root didn't.
    expect(warnings).toContain("season.trust_rules_unpublished");
    expect(await f.read<string>("TrustScoreRegistry", "scoresRoot", [0])).toBe(zeroHash);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from trust_scores where season_id = 0");
    expect(rows[0]!.n).toBe(3);
  }, 120_000);

  it("the 21:00 decision read the correction Alice made on-chain at 13:00", async () => {
    const asked = llm.calls.map((c) => c.input as { slot: string; bot: { name: string }; recent_corrections: { chip: string; note: string }[] });
    const { rows: named } = await db.query<{ name: string }>("select name from bots where id = 1");
    const own = asked.filter((input) => input.bot.name === named[0]!.name);
    expect(own.length).toBeGreaterThanOrEqual(3); // debut, 09:00, 13:00, 21:00
    expect(own.at(-1)!.recent_corrections).toEqual([{ chip: "too risky", note: "stop going all in" }]);
    // The ones before it had nothing to read.
    expect(own.slice(0, -1).every((input) => input.recent_corrections.length === 0)).toBe(true);
    const { rows } = await db.query<{ tx: string | null }>("select tx_hash as tx from corrections");
    expect(rows).toEqual([{ tx: expect.stringMatching(/^0x/) }]);
  });

  it("writes results with the battle rank against the house bot", async () => {
    const { rows } = await db.query<{ bot_id: string; battle_rank: number | null; trades: number }>(
      "select bot_id::text, battle_rank, trades from season_results where season_id = 0 order by bot_id",
    );
    expect(rows.map((r) => [r.bot_id, r.battle_rank === null ? null : r.battle_rank > 0])).toEqual([["1", true], ["2", null], ["3", true]]);
    expect(rows[0]!.trades).toBeGreaterThan(0);
  });

  it("settles the accepted challenge for the winner recomputed from results, and expires the open one", async () => {
    await index();
    const { rows } = await db.query<{ status: string; opponent: string | null; winner: string | null }>(
      `select status::text as status, opponent_bot::text as opponent, winner_bot::text as winner
       from challenges where season_id = 0 order by opponent_bot nulls last`,
    );
    const { rows: results } = await db.query<{ bot_id: string; return_bps: number; max_dd_bps: number }>(
      "select bot_id::text as bot_id, return_bps, max_dd_bps from season_results where season_id = 0",
    );
    const standings = new Map(results.map((r) => [BigInt(r.bot_id), { returnBps: r.return_bps, maxDdBps: r.max_dd_bps }]));
    expect(rows).toEqual([
      { status: "settled", opponent: "3", winner: challengeWinner(1n, 3n, standings).toString() },
      { status: "expired", opponent: null, winner: null },
    ]);
    expect(await f.read<number>("Challenges", "openCount", [1n])).toBe(0);
  }, 120_000);

  it("commits the trust scores once the rules are published, and verifyScore holds for every bot", async () => {
    await index();
    const { rows } = await db.query<{ status: string; root_tx: string | null }>("select status::text as status, root_tx from seasons where id = 0");
    expect(rows[0]).toMatchObject({ status: "closed" });
    expect(rows[0]!.root_tx).toMatch(/^0x/);

    await f.send(admin, "TrustScoreRegistry", "publishRules", [stringToHex("trust-v1-sprint", { size: 32 }), "https://example.invalid/trust-rules.md", `0x${"0d".repeat(32)}`]);
    // Closed on-chain already, so this run is for the scores only.
    expect(await closeSeasons(closeDeps, signal)).toEqual([]);
    const file = JSON.parse(uploads.get("https://storage.example/replay/season-0-scores.json")!);
    expect(await f.read<string>("TrustScoreRegistry", "scoresRoot", [0])).toBe(file.root);
    await index();
    const { rows: stored } = await db.query<{ root: string; rules: string }>(
      "select '0x' || encode(scores_root, 'hex') as root, trust_rules_version as rules from seasons where id = 0",
    );
    expect(stored[0]).toEqual({ root: file.root, rules: "trust-v1-sprint" });

    for (const bot of [1n, 2n, 3n]) {
      const p = (await scoreProof(db, 0, bot))!;
      expect(p.committedRoot).toBe(file.root);
      expect(p.root).toBe(file.root);
      const args = [0, bot, p.fRules, p.fDrawdown, p.fConsistency, p.fExplains, p.total] as const;
      expect(await f.read<string>("TrustScoreRegistry", "leafHash", [...args])).toBe(p.leaf);
      expect(await f.read<boolean>("TrustScoreRegistry", "verifyScore", [...args, p.proof])).toBe(true);
      // A changed factor doesn't verify.
      expect(await f.read<boolean>("TrustScoreRegistry", "verifyScore", [0, bot, p.fRules, p.fDrawdown, p.fConsistency, p.fExplains, p.total + 1, p.proof])).toBe(false);
    }
  }, 120_000);

  it("a second run sends and uploads nothing", async () => {
    await db.query("update seasons set status = 'closing' where id = 0"); // as if the indexer were behind
    uploads.clear();
    expect(await closeSeasons(closeDeps, signal)).toEqual([]);
    expect(uploads.size).toBe(0);
  }, 120_000);

  it("refuses to close when the public file isn't what was uploaded", async () => {
    await db.query(
      "insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades, trust_rules_version, status) values (1, $1, $2, 'sprint', 8, 'trust-v1-sprint', 'closing')",
      [at(1, "00:00").toISOString(), at(1, "21:30").toISOString()],
    );
    await f.send(committer, "SeasonLedger", "openSeason", [1, BigInt(at(1, "00:00").getTime() / 1000), BigInt(at(1, "21:30").getTime() / 1000)]);
    const tampered = { ...closeDeps, store: { ...closeDeps.store, get: async () => "something else" } };
    await expect(closeSeasons(tampered, signal)).rejects.toThrow("isn't what was uploaded");
    expect(await closeDeps.chain.isClosed(1)).toBe(false);
  }, 120_000);
});
