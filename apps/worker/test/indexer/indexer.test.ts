import { describe, expect, it } from "vitest";
import { ChainError } from "../../src/indexer/chain";
import type { Db } from "../../src/indexer/db";
import { CONFIRMATIONS, MAX_RANGE, OVERLAP } from "../../src/indexer/indexer";
import { START } from "./helpers/fake-chain";
import { buildHistory } from "./helpers/history";
import { seedBot, seedDecision } from "./helpers/seed";
import { ALICE, DECISION, PERSONA, drain, trade, useWorld } from "./helpers/world";

const w = useWorld();
const confirm = () => w.chain.mine(Number(CONFIRMATIONS));
const safeHead = () => w.chain.head - CONFIRMATIONS;
const count = async (table: string) =>
  (await w.db.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n;

describe("idempotent", () => {
  it("replaying any block range gives identical rows", async () => {
    const seed = buildHistory(w.chain);
    await seed(w.db);
    const indexer = await w.index();
    const rows = await w.db.snapshot();

    // Every table the indexer writes has something in it, or the comparison proves little.
    for (const table of ["bots", "bot_versions", "trades", "corrections", "daily_calls", "challenges"]) {
      expect(rows[table]!.length, table).toBeGreaterThan(0);
    }

    const last = indexer.nextBlock - 1n;
    for (let from = START; from <= last; from++) {
      for (let to = from; to <= last; to++) {
        await indexer.replay(from, to);
        expect(await w.db.snapshot(), `replay ${from}..${to}`).toEqual(rows);
      }
    }
  }, 180_000);

  it("the chunk size doesn't change the rows", async () => {
    const seed = buildHistory(w.chain);
    const results = [];
    for (const maxRange of [1n, 2n, 3n, 7n, 22n, MAX_RANGE]) {
      await w.db.reset();
      await seed(w.db);
      await w.index({ maxRange });
      const rows = await w.db.snapshot();
      // decisions.input_hash comes from a seed counter, so it isn't the indexer's.
      delete rows.decisions;
      results.push(rows);
    }
    for (const rows of results) expect(rows).toEqual(results[0]);
  }, 60_000);

  it("a fresh indexer over the same database changes nothing", async () => {
    const seed = buildHistory(w.chain);
    await seed(w.db);
    await w.index();
    const rows = await w.db.snapshot();
    await w.index();
    expect(await w.db.snapshot()).toEqual(rows);
  });

  it("refuses to replay past what's indexed", async () => {
    w.createBot();
    const indexer = await w.index();
    await expect(indexer.replay(START, indexer.nextBlock)).rejects.toThrow(RangeError);
    await expect(indexer.replay(START - 1n, START)).rejects.toThrow(RangeError);
  });
});

describe("the cursor only advances with the rows", () => {
  it("a database failure half-way leaves no rows and the same cursor", async () => {
    await seedBot(w.db, { id: 1n, owner: ALICE, personaHash: PERSONA });
    await seedDecision(w.db, DECISION, 1n);
    for (const actionIndex of [0, 1, 2]) w.chain.emit(w.chain.tx(), "PaperLedger", "Trade", { ...trade(), actionIndex });

    let inserts = 0;
    let failing = true;
    const db: Db = {
      ...w.db,
      transaction: (run) =>
        w.db.transaction((tx) =>
          run({
            query: (text, params) => {
              if (failing && text.includes("insert into trades") && ++inserts === 3) {
                return Promise.reject(Object.assign(new Error("terminating connection"), { code: "57P01" }));
              }
              return tx.query(text, params);
            },
          }),
        ),
    };
    const indexer = w.indexer({ db });
    confirm();

    await expect(indexer.tick()).rejects.toThrow("terminating connection");
    expect(await count("trades")).toBe(0);
    expect(indexer.nextBlock).toBe(START);

    failing = false;
    await drain(indexer);
    expect(await count("trades")).toBe(3);
    expect(indexer.nextBlock).toBe(safeHead() + 1n);
  });

  it("a failed commit leaves the cursor where it was", async () => {
    w.createBot();
    const db: Db = {
      ...w.db,
      transaction: (run) =>
        w.db.transaction(async (tx) => {
          await run(tx);
          throw new Error("commit failed");
        }),
    };
    const indexer = w.indexer({ db });
    confirm();
    await expect(indexer.tick()).rejects.toThrow("commit failed");
    expect(indexer.nextBlock).toBe(START);
    expect(await count("bots")).toBe(0);
    expect(w.log.problems()).toEqual([]);
  });

  it.each([
    ["a missing table", "42P01"],
    ["a deadlock", "40P01"],
    ["a lock timeout", "55P03"],
    ["a dropped connection", undefined],
  ])("%s is retried, never skipped as a bad event", async (_what, code) => {
    w.createBot();
    const db: Db = {
      ...w.db,
      transaction: (run) =>
        w.db.transaction((tx) =>
          run({
            query: (text, params) =>
              text.includes("insert into bots")
                ? Promise.reject(Object.assign(new Error("infrastructure"), { code }))
                : tx.query(text, params),
          }),
        ),
    };
    const indexer = w.indexer({ db });
    confirm();
    await expect(indexer.tick()).rejects.toThrow("infrastructure");
    expect(indexer.nextBlock).toBe(START);
  });

  it("an RPC failure inside a handler is retried, never skipped", async () => {
    w.createBot();
    const indexer = w.indexer({ sources: [w.chain.as("rpc", { fail: (method) => method === "botState" })] });
    confirm();
    await expect(indexer.tick()).rejects.toThrow(ChainError);
    expect(indexer.nextBlock).toBe(START);
    expect(w.log.problems()).toEqual([]);
  });

  it("does nothing while another worker holds the lock", async () => {
    w.createBot();
    const db: Db = {
      ...w.db,
      transaction: (run) =>
        w.db.transaction((tx) =>
          run({
            query: <Row extends object>(text: string, params?: unknown[]) =>
              text.includes("pg_try_advisory_xact_lock")
                ? Promise.resolve({ rows: [{ locked: false }] as unknown as Row[] })
                : tx.query<Row>(text, params),
          }),
        ),
    };
    const indexer = w.indexer({ db });
    confirm();
    expect((await indexer.tick()).live).toEqual({ status: "busy" });
    expect(indexer.nextBlock).toBe(START);
    expect(await count("bots")).toBe(0);
  });
});

describe("RPC", () => {
  it.each(["check", "head", "logs", "botState", "blockTime"])("fails over when %s fails", async (method) => {
    w.createBot();
    const broken = w.chain.as("rpc3", { fail: (m) => m === method });
    await w.index({ sources: [broken, w.chain.as("rpc4")] });
    expect(await count("bots")).toBe(1);
  });

  it("says so when every RPC fails, and keeps the cursor", async () => {
    w.createBot();
    const sources = ["rpc3", "rpc4"].map((name) => w.chain.as(name, { down: () => true }));
    const indexer = w.indexer({ sources });
    await expect(indexer.tick()).rejects.toThrow(/rpc3.*rpc4/);
    expect(indexer.nextBlock).toBe(START);
  });

  it("never asks a node for blocks past that node's head", async () => {
    w.chain.mine(20);
    w.createBot();
    confirm();
    const slow = w.chain.as("rpc3", { head: () => START + 5n });
    const fast = w.chain.as("rpc4");
    const indexer = w.indexer({ sources: [slow, fast] });
    // The slow node serves the first range, as far as it safely can. The next one has to fail over.
    await indexer.tick();
    expect(indexer.nextBlock).toBe(START + 5n - CONFIRMATIONS + 1n);
    await drain(indexer);

    expect(slow.requests).toHaveLength(1);
    for (const request of slow.requests) expect(request.to).toBeLessThanOrEqual(START + 5n - CONFIRMATIONS);
    expect(indexer.nextBlock).toBe(safeHead() + 1n);
    expect(await count("bots")).toBe(1);
  });

  it("asks for bounded ranges with no gap", async () => {
    w.chain.mine(25_000);
    w.createBot();
    const source = w.chain.as();
    await w.index({ sources: [source] });

    let expected = START;
    for (const { from, to } of source.requests) {
      expect(from).toBe(expected === START ? START : expected - OVERLAP);
      expect(to - from + 1n).toBeLessThanOrEqual(MAX_RANGE);
      expected = to + 1n;
    }
    expect(expected).toBe(safeHead() + 1n);
    expect(await count("bots")).toBe(1);
  });

  it("refuses an answer with blocks outside the range it asked for", async () => {
    w.createBot();
    const source = w.chain.as();
    const logs = source.logs;
    source.logs = async (from, to) => (await logs(from, to)).map((log) => ({ ...log, blockNumber: to + 5n }));
    const indexer = w.indexer({ sources: [source] });
    confirm();
    await expect(indexer.tick()).rejects.toThrow(/for range/);
    expect(indexer.nextBlock).toBe(START);
  });

  it("is idle when there is no new block", async () => {
    const indexer = await w.index();
    expect(await indexer.tick()).toEqual({ live: { status: "idle" }, more: false });
  });
});

it("reports a skipped event once, however often it is replayed", async () => {
  const tx = w.chain.tx();
  w.chain.emit(tx, "PaperLedger", "Trade", trade());
  const indexer = await w.index();
  await indexer.replay(tx.block, tx.block);
  await indexer.replay(tx.block, tx.block);
  expect(w.log.problems()).toHaveLength(1);
});
