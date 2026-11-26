import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../indexer/helpers/db";
import { ACCOUNTS, startFork, type Fork } from "../indexer/helpers/fork";
import { readFileSync } from "node:fs";
import { openDueSeasons } from "../../src/seasons/checks";
import { createSeasonChain } from "../../src/seasons/ledger";
import { createSystemSender } from "../../src/system/sender";

const fork = await startFork();

describe.skipIf(!fork)("season open on the real SeasonLedger, on an Anvil fork", () => {
  let f: Fork;
  let db: TestDb;

  beforeAll(async () => {
    f = fork!;
    db = await createTestDb();
    await db.query(readFileSync(new URL("../../../../packages/db/seeds/seasons.sql", import.meta.url), "utf8"));
  }, 60_000);
  afterAll(async () => {
    await db?.close();
    fork?.stop();
  });

  const chain = (account: (typeof ACCOUNTS)["committer"]) =>
    createSeasonChain({
      client: f.client,
      address: f.addresses.SeasonLedger,
      sender: createSystemSender({ rpcUrls: [f.url], account }),
    });
  const now = new Date("2026-11-29T00:00:00+05:30");
  const log = { info() {}, warn() {} };
  const signal = new AbortController().signal;

  it("a wallet without COMMITTER_ROLE sends nothing", async () => {
    const before = await f.client.getTransactionCount({ address: ACCOUNTS.runner.address });
    await expect(openDueSeasons({ db, chain: chain(ACCOUNTS.runner), now, signal, log })).rejects.toThrow();
    expect(await f.client.getTransactionCount({ address: ACCOUNTS.runner.address })).toBe(before);
  }, 60_000);

  it("the committer opens the due seasons once, with the table's times", async () => {
    const committer = chain(ACCOUNTS.committer);
    // S1 is due too, but the contract opens it only after S0's close (#219 item 3).
    expect(await openDueSeasons({ db, chain: committer, now, signal, log })).toEqual([0]);
    expect(await openDueSeasons({ db, chain: committer, now, signal, log })).toEqual([]);
    expect(await committer.nextSeason()).toBe(1);
    const [start, end, , , closed] = await f.read<[bigint, bigint, string, string, boolean]>("SeasonLedger", "seasons", [0]);
    expect(start).toBe(BigInt(Date.parse("2026-11-27T00:00:00+05:30") / 1000));
    expect(end).toBe(BigInt(Date.parse("2026-11-28T21:30:00+05:30") / 1000));
    expect(closed).toBe(false);
  }, 120_000);
});
