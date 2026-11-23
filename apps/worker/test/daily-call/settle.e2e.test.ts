import { dailyCallBotViewTypedData, istDay } from "@botfolio/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadWorkerConfig } from "../../src/config";
import { createDailyCallChain } from "../../src/daily-call";
import { settleDailyCalls } from "../../src/daily-call/settle";
import { createChainSource } from "../../src/indexer/chain";
import { CONFIRMATIONS, Indexer } from "../../src/indexer/indexer";
import { readFeed } from "../../src/oracle";
import { createSystemSender } from "../../src/system/sender";
import { createTestDb, type TestDb } from "../indexer/helpers/db";
import { ACCOUNTS, startFork, type Fork } from "../indexer/helpers/fork";
import { drain, memoryLog } from "../indexer/helpers/world";

const fork = await startFork();
const { alice, runner, committer } = ACCOUNTS;

// #54's Done-when: daily_calls rows settled, and they match the chain.
describe.skipIf(!fork)("Daily Call settlement on an Anvil fork", () => {
  let f: Fork;
  let db: TestDb;

  beforeAll(async () => {
    f = fork!;
    db = await createTestDb();
  }, 60_000);
  afterAll(async () => {
    await db?.close();
    fork?.stop();
  });

  it("waits before 21:00, settles after, once, and the indexed row matches the contract", async () => {
    const day = istDay(Number((await f.client.getBlock()).timestamp)) + 1;
    const at = (secondsIntoDay: number) => BigInt(day * 86_400 - 19_800 + secondsIntoDay);
    await f.setClock(at(10 * 3600));
    await f.relay(alice, "BotRegistry", "createBot", [`0x${"a1".repeat(32)}`, 4000, 4]);
    const sig = await runner.signTypedData(
      dailyCallBotViewTypedData(f.addresses.DailyCall, { botId: 1n, day, botUp: false }),
    );
    await f.relay(alice, "DailyCall", "call", [1n, true, false, sig]);

    const { addresses, deployBlock: startBlock, url } = f;
    const log = memoryLog();
    const indexer = new Indexer({ db, sources: [createChainSource(url, addresses)], addresses, startBlock, log });
    const index = async () => {
      await f.confirm(CONFIRMATIONS);
      await drain(indexer);
    };
    await index();

    const btc = loadWorkerConfig({}).feeds.find((feed) => feed.asset === "BTC")!;
    const chain = createDailyCallChain({
      client: f.client,
      address: addresses.DailyCall,
      sender: createSystemSender({ rpcUrls: [url], account: committer }),
    });
    const settle = async (secondsIntoDay: number) => {
      const now = new Date(Number(at(secondsIntoDay)) * 1000);
      return settleDailyCalls({
        db,
        chain,
        readBtc: (seconds) => readFeed(f.client, btc, seconds),
        scheduledFor: new Date(Number(at(21 * 3600)) * 1000),
        now,
        signal: new AbortController().signal,
        log: { info() {}, warn() {} },
      });
    };

    await f.setClock(at(20 * 3600 + 3000)); // the newest round is from 20:50
    expect(await settle(20 * 3600 + 3600)).toBe(0);

    await f.setClock(at(21 * 3600 + 60), { btcBps: 100n });
    expect(await settle(21 * 3600 + 120)).toBe(1);
    expect(await settle(21 * 3600 + 130)).toBe(0); // the chain knows before the indexer does

    await index();
    const call = await f.read<readonly unknown[]>("DailyCall", "calls", [1n, day]);
    const row = (
      await db.query<{ user: boolean; bot: boolean; settled: boolean }>(
        `select user_correct as "user", bot_correct as bot, settle_tx is not null as settled from daily_calls`,
      )
    ).rows[0];
    expect(row).toEqual({ user: call[6], bot: call[7], settled: true });
    expect(row).toMatchObject({ user: true, bot: false });
  }, 120_000);
});
