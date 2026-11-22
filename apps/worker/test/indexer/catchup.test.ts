import { describe, expect, it } from "vitest";
import { decisionIdFromUuid } from "@botfolio/shared";
import { ChainError } from "../../src/indexer/chain";
import { CONFIRMATIONS, MAX_RANGE, OVERLAP } from "../../src/indexer/indexer";
import { MAX_WAITING_BLOCKS, RETRY_BLOCKS, RETRY_EVERY_MS, WaitingBlocks } from "../../src/indexer/waiting";
import type { Problem } from "../../src/indexer/apply";
import { START } from "./helpers/fake-chain";
import { buildHistory } from "./helpers/history";
import { hash, seedBot, seedDecision, seedSeason } from "./helpers/seed";
import { ALICE, CODE, DECISION, PERSONA, drain, trade, useWorld } from "./helpers/world";

const w = useWorld();
const count = async (table: string) =>
  (await w.db.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n;
const confirm = () => w.chain.mine(Number(CONFIRMATIONS));

async function seedAliceWithDecision() {
  await seedBot(w.db, { id: 1n, owner: ALICE, personaHash: PERSONA });
  await seedDecision(w.db, DECISION, 1n);
}

describe("start block = deploy block", () => {
  it("indexes an event in the start block itself", async () => {
    const tx = w.chain.tx({ sameBlock: true });
    expect(tx.block).toBe(START);
    await seedSeason(w.db, 0);
    w.chain.emit(tx, "SeasonLedger", "SeasonClosed", { n: 0, dataRoot: hash(1), dataURI: "u" });
    await w.index();
    expect((await w.db.query("select root_tx from seasons")).rows).toEqual([{ root_tx: tx.hash }]);
  });

  it("refuses a start block after the deploy, which would lose events", async () => {
    w.chain.mine(10);
    const indexer = w.indexer({ startBlock: START + 1n });
    await expect(indexer.tick()).rejects.toThrow(/after the deploy/);
    await expect(indexer.tick()).rejects.toThrow(/after the deploy/);
    expect(indexer.nextBlock).toBe(START + 1n);
  });

  it("accepts an earlier one", async () => {
    w.createBot();
    await w.index({ startBlock: START - 50n });
    expect(await count("bots")).toBe(1);
  });

  it("asks the next RPC when one has no historical state", async () => {
    w.chain.mine(10);
    const pruned = w.chain.as("rpc3", { fail: (method) => method === "hasCodeAt" });
    const indexer = w.indexer({ startBlock: START + 1n, sources: [pruned, w.chain.as("rpc4")] });
    await expect(indexer.tick()).rejects.toThrow(/after the deploy/);
  });

  it("warns and goes on when none has historical state", async () => {
    w.createBot();
    await w.index({ sources: [w.chain.as("rpc3", { fail: (method) => method === "hasCodeAt" })] });
    expect(w.log.lines.map((l) => l.message)).toContain("can't verify that the start block is the deploy block");
    expect(await count("bots")).toBe(1);
  });

  it("waits instead of going on unchecked when no RPC is up", async () => {
    const indexer = w.indexer({ sources: [w.chain.as("rpc3", { down: () => true })] });
    await expect(indexer.tick()).rejects.toThrow(ChainError);
    expect(w.log.lines).toEqual([]);
  });

  it("says so when the cursor is past the whole chain", async () => {
    // This fake chain has code from START on, so make it look undeployed at that height.
    const source = w.chain.as();
    source.hasCodeAt = async () => false;
    const ahead = w.indexer({ startBlock: START + 100_000n, sources: [source] });
    await expect(ahead.tick()).rejects.toThrow(/past the chain's head/);
    expect(ahead.nextBlock).toBe(START + 100_000n);
  });
});

describe("waits for 2 confirmations", () => {
  it("is 2 or more", () => {
    expect(CONFIRMATIONS).toBeGreaterThanOrEqual(2n);
  });

  it("leaves an event alone at 0 and 1, and writes it at 2", async () => {
    w.createBot();
    const indexer = w.indexer();
    for (const confirmations of [0, 1]) {
      await drain(indexer);
      expect(await count("bots"), `${confirmations} confirmations`).toBe(0);
      w.chain.mine(1);
    }
    await drain(indexer);
    expect(await count("bots")).toBe(1);
  });

  it("reads contract state at a confirmed block too", async () => {
    w.createBot();
    confirm();
    const paused = w.chain.tx();
    w.chain.setBot(1n, { active: false }, paused.block);
    const indexer = w.indexer();
    await drain(indexer);
    // The pause has no confirmations yet, so neither it nor its state shows.
    expect((await w.db.query("select status::text as status from bots")).rows).toEqual([{ status: "active" }]);
  });
});

describe("resumes after a restart", () => {
  it("picks up after the last stored trade and doesn't repeat history first", async () => {
    await seedAliceWithDecision();
    w.createBot();
    w.chain.mine(20_000);
    const traded = w.chain.tx();
    w.chain.emit(traded, "PaperLedger", "Trade", trade());
    await w.index();

    w.chain.mine(30);
    const late = w.createBot(2n, "0x0000000000000000000000000000000000000b0b", hash(0xbbbb));
    confirm();
    const source = w.chain.as();
    const restarted = w.indexer({ sources: [source] });
    const first = await restarted.tick();

    // New blocks before the repair pass, so a debut doesn't wait for the history to be read again.
    expect(source.requests[0]).toEqual({ from: traded.block + 1n - OVERLAP, to: late.block });
    expect(first.live.status).toBe("written");
    expect(await count("bots")).toBe(2);
  });

  it("starts from the start block when no trade is stored", async () => {
    w.createBot();
    await w.index();
    const source = w.chain.as();
    await drain(w.indexer({ sources: [source] }));
    expect(source.requests[0]!.from).toBe(START);
  });

  it("then reads the history again in the background, and the rows stay the same", async () => {
    const seed = buildHistory(w.chain);
    await seed(w.db);
    await w.index();
    const rows = await w.db.snapshot();

    const source = w.chain.as();
    await w.index({ sources: [source] });
    expect(source.requests.some((r) => r.from === START)).toBe(true);
    expect(await w.db.snapshot()).toEqual(rows);
  });

  it("restarting again and again part-way ends with the rows of an uninterrupted run", async () => {
    const seed = buildHistory(w.chain);
    confirm();
    await seed(w.db);
    await drain(w.indexer());
    const uninterrupted = await w.db.snapshot();

    for (const ticksPerLife of [1, 2, 5]) {
      await w.db.reset();
      await seed(w.db);
      for (let ticks = ticksPerLife; ticks <= 40; ticks += ticksPerLife) {
        // Each process reads a little further before it dies, and the one after starts from nothing but the rows.
        const indexer = w.indexer({ maxRange: 3n });
        for (let i = 0; i < ticks; i++) await indexer.tick();
      }
      await drain(w.indexer({ maxRange: 3n }));
      const rows = await w.db.snapshot();
      expect({ ...rows, decisions: [] }).toEqual({ ...uninterrupted, decisions: [] });
    }
  }, 120_000);

  it("a crash before the commit resumes from the last committed range", async () => {
    await seedAliceWithDecision();
    const first = w.chain.tx();
    w.chain.emit(first, "PaperLedger", "Trade", trade());
    w.chain.mine(50);
    w.chain.emit(w.chain.tx(), "PaperLedger", "Trade", { ...trade(), actionIndex: 1 });
    confirm();

    let transactions = 0;
    const crashing = w.indexer({
      maxRange: 25n,
      db: {
        ...w.db,
        transaction: (run) =>
          w.db.transaction(async (tx) => {
            const result = await run(tx);
            if (++transactions > 1) throw new Error("killed before commit");
            return result;
          }),
      },
    });
    await crashing.tick();
    await expect(crashing.tick()).rejects.toThrow("killed before commit");
    expect(await count("trades")).toBe(1);

    await drain(w.indexer({ maxRange: 25n }));
    expect(await count("trades")).toBe(2);
  });

  it("the repair pass finds what was waiting when the last process died", async () => {
    await seedBot(w.db, { id: 1n, owner: ALICE, personaHash: PERSONA });
    w.chain.emit(w.chain.tx(), "Challenges", "ChallengeCreated", { code: CODE, myBot: 1n, season: 0 });
    w.chain.mine(100);
    await seedDecision(w.db, DECISION, 1n);
    w.chain.emit(w.chain.tx(), "PaperLedger", "Trade", trade());
    await w.index();
    expect(await count("challenges")).toBe(0);

    await seedSeason(w.db, 0);
    await w.index();
    expect(await count("challenges")).toBe(1);
  });
});

describe("catch-up", () => {
  it("doesn't pause until it has read the whole backfill", async () => {
    w.chain.mine(25_000);
    w.createBot();
    confirm();
    const indexer = w.indexer();

    let ticks = 1;
    while ((await indexer.tick()).more) ticks++;
    expect(ticks).toBe(6);
    expect(indexer.nextBlock).toBe(w.chain.head - CONFIRMATIONS + 1n);
    expect(await count("bots")).toBe(1);
  });

  it("stays inside QIE's 10,000-block getLogs limit", () => {
    expect(MAX_RANGE).toBeLessThanOrEqual(10_000n);
  });

  it("shrinks the range when every RPC refuses it, then grows it back", async () => {
    w.chain.mine(20_000);
    w.createBot();
    confirm();
    const source = w.chain.as();
    const logs = source.logs;
    let limit = 300n;
    source.logs = (from, to) => {
      if (to - from + 1n > limit) return Promise.reject(new ChainError("too many results"));
      return logs(from, to);
    };
    const indexer = w.indexer({ sources: [source] });

    let written = 0;
    for (let i = 0; i < 20 && written === 0; i++) {
      const result = await indexer.tick().catch(() => null);
      if (result?.live.status === "written") written = Number(result.live.to - result.live.from + 1n);
    }
    expect(written).toBeGreaterThan(0);
    expect(written).toBeLessThanOrEqual(300);

    limit = MAX_RANGE;
    await drain(indexer);
    expect(await count("bots")).toBe(1);
    expect(source.requests.some((r) => r.to - r.from + 1n === MAX_RANGE)).toBe(true);
  });

  it("gets through a range only one block wide", async () => {
    await seedAliceWithDecision();
    w.chain.emit(w.chain.tx(), "PaperLedger", "Trade", trade());
    w.chain.mine(40);
    await w.index({ maxRange: 1n });
    expect(await count("trades")).toBe(1);
  });

  it("a frozen first RPC doesn't freeze the indexer", async () => {
    const frozen = w.chain.as("rpc3", { head: () => START + 1n });
    w.chain.mine(10);
    w.createBot();
    await w.index({ sources: [frozen, w.chain.as("rpc4")] });
    expect(await count("bots")).toBe(1);
  });

  it("shrinks a range of history the RPC refuses, while new blocks keep being written", async () => {
    await seedBot(w.db, { id: 1n, owner: ALICE, personaHash: PERSONA });
    await seedDecision(w.db, DECISION, 1n);
    w.chain.emit(w.chain.tx(), "Challenges", "ChallengeCreated", { code: CODE, myBot: 1n, season: 0 });
    w.chain.mine(3000);
    w.chain.emit(w.chain.tx(), "PaperLedger", "Trade", trade());
    await w.index();
    await seedSeason(w.db, 0);

    const source = w.chain.as();
    const logs = source.logs;
    source.logs = (from, to) =>
      to - from + 1n > 200n ? Promise.reject(new ChainError("too many results")) : logs(from, to);
    const indexer = w.indexer({ sources: [source] });
    // A block between ticks, as on the real chain: each live success must not undo the history's shrinking.
    for (let i = 0; i < 80 && (await count("challenges")) === 0; i++) {
      w.chain.mine(1);
      await indexer.tick();
    }
    expect(await count("challenges")).toBe(1);
  });

  it("new blocks still land while the replay of history fails", async () => {
    await seedAliceWithDecision();
    w.chain.emit(w.chain.tx(), "PaperLedger", "Trade", trade());
    w.chain.mine(100);
    w.chain.emit(w.chain.tx(), "PaperLedger", "Trade", { ...trade(), actionIndex: 1 });
    await w.index();

    const source = w.chain.as();
    const logs = source.logs;
    source.logs = (from, to) => (from === START ? Promise.reject(new ChainError("no history")) : logs(from, to));
    w.createBot();
    confirm();
    const indexer = w.indexer({ sources: [source] });
    expect((await indexer.tick()).more).toBe(false);
    expect(await count("bots")).toBe(1);
    expect(w.log.lines.map((l) => l.message)).toContain("replay failed, retrying");
  });
});

describe("idempotent on (tx, logIndex)", () => {
  const correction = { botId: 1n, decisionId: decisionIdFromUuid(DECISION), noteHash: hash(1), chip: 0, season: 0 };

  it("one log sent twice by the RPC is one event", async () => {
    await seedAliceWithDecision();
    const tx = w.chain.tx();
    const log = w.chain.emit(tx, "SeasonLedger", "CallCorrected", correction);
    w.chain.emit(tx, "SeasonLedger", "CallCorrected", correction);
    w.chain.logs.push({ ...log });
    w.chain.emit(w.chain.tx(), "PaperLedger", "Trade", trade());
    // corrections has no log_index, so counted twice the first would push the second onto a third row on replay.
    for (let restart = 0; restart < 3; restart++) await w.index();
    expect(await count("corrections")).toBe(2);
    expect(await count("trades")).toBe(1);
  });

  it("two log indexes with the same content are two events, however often they are read", async () => {
    await seedAliceWithDecision();
    const tx = w.chain.tx();
    w.chain.emit(tx, "SeasonLedger", "CallCorrected", correction);
    w.chain.emit(tx, "SeasonLedger", "CallCorrected", correction);
    for (let restart = 0; restart < 3; restart++) await w.index();
    expect(await count("corrections")).toBe(2);
  });
});

describe("reading the last blocks again", () => {
  it("picks up logs a node served late", async () => {
    w.createBot();
    confirm();
    const source = w.chain.as();
    const logs = source.logs;
    let late = true;
    source.logs = async (from, to) => (late ? [] : logs(from, to));
    const indexer = w.indexer({ sources: [source] });
    await indexer.tick();
    expect(await count("bots")).toBe(0);

    late = false;
    w.chain.mine(1);
    await indexer.tick();
    expect(await count("bots")).toBe(1);
  });

  it("follows a trade that a reorg moved to another tx", async () => {
    await seedAliceWithDecision();
    w.chain.emit(w.chain.tx(), "PaperLedger", "Trade", trade());
    const indexer = await w.index();

    w.chain.logs.length = 0;
    const moved = w.chain.tx();
    w.chain.emit(moved, "PaperLedger", "Trade", trade());
    confirm();
    await drain(indexer);
    expect((await w.db.query("select tx_hash from trades")).rows).toEqual([{ tx_hash: moved.hash }]);
  });
});

describe("waiting events", () => {
  it("are retried once their row appears, at most once a minute", async () => {
    await seedBot(w.db, { id: 1n, owner: ALICE, personaHash: PERSONA });
    let now = 0;
    w.chain.emit(w.chain.tx(), "PaperLedger", "Trade", trade());
    w.chain.mine(50); // out of the overlap
    const indexer = await w.index({ now: () => now });
    expect(await count("trades")).toBe(0);

    await seedDecision(w.db, DECISION, 1n);
    now += RETRY_EVERY_MS - 1;
    await indexer.tick();
    expect(await count("trades")).toBe(0);

    now += 1;
    await indexer.tick();
    expect(await count("trades")).toBe(1);
  });

  const problem = (block: bigint, kind: Problem["kind"] = "waiting"): Problem => ({
    block,
    kind,
    txHash: hash(Number(block)),
    logIndex: 0,
    event: "PaperLedger.Trade",
    reason: "no decisions row",
  });

  it("forgets a block once it is written, and never keeps a skipped event", () => {
    const waiting = new WaitingBlocks();
    waiting.update(1n, 10n, [problem(3n), problem(4n, "skipped")]);
    expect(waiting.size).toBe(1);
    waiting.update(3n, 3n, []);
    expect(waiting.size).toBe(0);
  });

  it("goes round, so stuck blocks can't starve the rest", () => {
    const waiting = new WaitingBlocks();
    const blocks = Array.from({ length: RETRY_BLOCKS * 2 }, (_, i) => BigInt(i + 1));
    waiting.update(1n, 100n, blocks.map((block) => problem(block)));
    expect(waiting.take(0)).toEqual(blocks.slice(0, RETRY_BLOCKS));
    expect(waiting.take(RETRY_EVERY_MS)).toEqual(blocks.slice(RETRY_BLOCKS));
  });

  it("is bounded", () => {
    const waiting = new WaitingBlocks();
    const many = Array.from({ length: MAX_WAITING_BLOCKS + 5 }, (_, i) => problem(BigInt(i + 1)));
    waiting.update(1n, 10_000n, many);
    expect(waiting.size).toBe(MAX_WAITING_BLOCKS);
  });
});
