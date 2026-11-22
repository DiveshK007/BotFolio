import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { orderIdOf, decisionIdFromUuid } from "@botfolio/shared";
import { startIndexer } from "../../src/indexer";
import { CONTRACT_NAMES } from "../../src/indexer/abi";
import { createChainSource } from "../../src/indexer/chain";
import { ADDRESS_ENV } from "../../src/indexer/config";
import { CONFIRMATIONS, Indexer } from "../../src/indexer/indexer";
import { createTestDb, type TestDb } from "./helpers/db";
import { ACCOUNTS, startFork, type Fork } from "./helpers/fork";
import {
  IDS,
  VALUES,
  openAndCreateBots,
  play,
  seedOffChain,
  seedSeasons,
  type Opened,
  type Played,
} from "./helpers/scenario";
import { drain, memoryLog } from "./helpers/world";

// The "test bot" of #46 on a local fork: real contracts, real forwarder, real event encoding. Each row is compared
// with what the contracts themselves say, not with the events it came from.
const fork = await startFork();

describe.skipIf(!fork)("DB rows match the chain, on an Anvil fork of QIE mainnet", () => {
  const { alice, bob, admin, relayer } = ACCOUNTS;
  let f: Fork;
  let db: TestDb;
  let indexer: Indexer;
  let opened: Opened;
  let played: Played;
  const log = memoryLog();

  beforeAll(async () => {
    f = fork!;
    db = await createTestDb();
    const { addresses, deployBlock: startBlock, url } = f;
    // The first endpoint is dead, so the whole run also goes through failover.
    const sources = ["http://127.0.0.1:1", url].map((rpc) => createChainSource(rpc, addresses));
    indexer = new Indexer({ db, sources, addresses, startBlock, log });

    await seedSeasons(db);
    opened = await openAndCreateBots(f);
    await f.confirm(CONFIRMATIONS);
    await drain(indexer);
    await seedOffChain(db, opened);
    played = await play(f, opened);
    await f.confirm(CONFIRMATIONS);
    await drain(indexer);
  }, 300_000);

  afterAll(async () => {
    await db?.close();
    fork?.stop();
  });

  const rowsOf = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;

  it("bots match BotRegistry", async () => {
    const rows = await rowsOf(
      `select id::text as id, owner_wallet, encode(persona_hash, 'hex') as hash, is_house, status::text as status,
       extract(epoch from created_at)::bigint::text as created from bots order by bots.id`,
    );
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      const id = BigInt(row.id as string);
      const bot = await f.read<{
        owner: string;
        personaHash: string;
        createdAt: bigint;
        active: boolean;
        house: boolean;
      }>("BotRegistry", "getBot", [id]);
      const banned = await f.read<boolean>("BotRegistry", "banned", [id]);
      expect(row).toEqual({
        id: id.toString(),
        owner_wallet: bot.owner.toLowerCase(),
        hash: bot.personaHash.slice(2),
        is_house: bot.house,
        status: bot.active ? "active" : banned ? "banned" : "paused",
        created: bot.createdAt.toString(),
      });
    }
    expect(rows.map((row) => row.status)).toEqual(["active", "paused", "banned", "active"]);
  });

  it("versions match the registry and SeasonLedger", async () => {
    const rows = await rowsOf(
      `select bot_id::text as bot, version, max_per_coin_bps as cap, max_trades_per_day as per_day,
       encode(config_hash, 'hex') as hash from bot_versions order by bot_versions.bot_id, version`,
    );
    expect(rows).toHaveLength(5);
    const v2 = await f.read<{ version: number; maxPerCoinBps: number; maxTradesPerDay: number }>(
      "BotRegistry",
      "getBot",
      [IDS.aliceBot],
    );
    expect(rows[1]).toEqual({
      bot: "1",
      version: v2.version,
      cap: v2.maxPerCoinBps,
      per_day: v2.maxTradesPerDay,
      hash: (await f.read<string>("SeasonLedger", "configHash", [IDS.aliceBot, 2])).slice(2),
    });
    expect(rows[0]).toMatchObject({ bot: "1", version: 1, cap: 4000, hash: VALUES.alicePersona.slice(2) });
  });

  it("trades add up to each portfolio's exact cash and holdings", async () => {
    const trades = await rowsOf(
      `select bot_id::text as bot, asset::text as asset, side::text as side, cash_e8::text as cash,
       units_e18::text as units, encode(order_id, 'hex') as order_id, price_e8::text as price, round_id::text as round
       from trades order by block_number, log_index`,
    );
    expect(trades).toHaveLength(4);

    const startCash = await f.read<bigint>("PaperLedger", "START_CASH_E8");
    const assets = ["BTC", "ETH", "SOL", "XRP", "GOLD"];
    for (const bot of [IDS.aliceBot, IDS.bobBot]) {
      let cash = startCash;
      const units = [0n, 0n, 0n, 0n, 0n];
      for (const trade of trades.filter((t) => t.bot === bot.toString())) {
        const sign = trade.side === "BUY" ? 1n : -1n;
        cash -= sign * BigInt(trade.cash as string);
        units[assets.indexOf(trade.asset as string)]! += sign * BigInt(trade.units as string);
        expect(await f.read("PaperLedger", "usedOrder", [`0x${trade.order_id}`])).toBe(true);

        const round = f.rounds[assets.indexOf(trade.asset as string)]!;
        expect([trade.price, trade.round]).toEqual([round.answer.toString(), round.roundId.toString()]);
      }
      const [onChainCash] = await f.read<[bigint]>("PaperLedger", "portfolios", [bot]);
      expect(cash).toBe(onChainCash);
      expect(units).toEqual(await f.read<bigint[]>("PaperLedger", "holdings", [bot]));
    }
  });

  it("the approved big move is the owner's trade", async () => {
    const orderId = orderIdOf(decisionIdFromUuid(IDS.aliceDecision), 1).slice(2);
    expect(await rowsOf("select encode(order_id, 'hex') as id, status::text as status, user_tx from big_moves")).toEqual([
      { id: orderId, status: "approved", user_tx: played.approveTx },
    ]);
    expect(await rowsOf(`select tx_hash from trades where encode(order_id, 'hex') = '${orderId}'`)).toEqual([
      { tx_hash: played.approveTx },
    ]);
  });

  it("the Daily Call matches the contract", async () => {
    const [userUp, botUp, price, round, , settled, userCorrect, botCorrect] = await f.read<unknown[]>(
      "DailyCall",
      "calls",
      [IDS.aliceBot, opened.day],
    );
    expect([settled, userCorrect, botCorrect]).toEqual([true, true, false]);
    expect(
      await rowsOf(
        `select day, user_wallet, user_up, bot_up, encode(bot_up_sig, 'hex') as sig, price_at_call_e8::text as price,
         round_at_call::text as round, call_tx, settle_tx, user_correct, bot_correct from daily_calls`,
      ),
    ).toEqual([
      {
        day: opened.day,
        user_wallet: alice.address.toLowerCase(),
        user_up: userUp,
        bot_up: botUp,
        sig: opened.botUpSig.slice(2),
        price: String(price),
        round: String(round),
        call_tx: played.callTx,
        settle_tx: played.settleTx,
        user_correct: userCorrect,
        bot_correct: botCorrect,
      },
    ]);
  });

  it("challenges match the contract", async () => {
    const rows = await rowsOf(
      `select code, challenger_bot::text as challenger, coalesce(opponent_bot, 0)::text as opponent, season_id,
       status::text as status, winner_bot::text as winner from challenges`,
    );
    expect(rows).toHaveLength(2);
    const statuses = ["none", "open", "accepted", "settled", "expired"];
    for (const row of rows) {
      const [challenger, opponent, season, status] = await f.read<[bigint, bigint, number, number]>(
        "Challenges",
        "challenges",
        [row.code],
      );
      expect(row).toEqual({
        code: row.code,
        challenger: challenger.toString(),
        opponent: opponent.toString(),
        season_id: season,
        status: statuses[status],
        winner: row.code === played.acceptedCode ? IDS.bobBot.toString() : null,
      });
    }
  });

  it("the season and its scores match the contracts", async () => {
    const [start, end, root, uri] = await f.read<[bigint, bigint, string, string]>("SeasonLedger", "seasons", [0]);
    expect(
      await rowsOf(
        `select extract(epoch from starts_at)::bigint::text as starts, extract(epoch from ends_at)::bigint::text as ends,
         status::text as status, encode(data_root, 'hex') as root, data_uri, root_tx,
         encode(scores_root, 'hex') as scores, scores_tx, trust_rules_version as rules from seasons where id = 0`,
      ),
    ).toEqual([
      {
        starts: start.toString(),
        ends: end.toString(),
        status: "closed",
        root: root.slice(2),
        data_uri: uri,
        root_tx: played.closeTx,
        scores: (await f.read<string>("TrustScoreRegistry", "scoresRoot", [0])).slice(2),
        scores_tx: played.scoresTx,
        rules: "trust-v1-sprint",
      },
    ]);
  });

  it("a user's action is the user's, never the relayer's", async () => {
    const tx = await f.client.getTransaction({ hash: played.correctionTx });
    expect(tx.from.toLowerCase()).toBe(relayer.address.toLowerCase());

    expect(await rowsOf("select user_wallet, note, tx_hash from corrections")).toEqual([
      { user_wallet: alice.address.toLowerCase(), note: VALUES.note, tx_hash: played.correctionTx },
    ]);
    const owners = (await rowsOf("select owner_wallet from bots order by id")).map((row) => row.owner_wallet);
    expect(owners).toEqual([alice, bob, ACCOUNTS.carol, admin].map((who) => who.address.toLowerCase()));
    expect(JSON.stringify(await db.snapshot())).not.toContain(relayer.address.slice(2).toLowerCase());
  });

  it("only the three hostile corrections were skipped", () => {
    expect(log.problems().map(({ event, reason }) => `${event}: ${reason}`)).toEqual([
      "SeasonLedger.CallCorrected: the decision belongs to another bot",
      "SeasonLedger.CallCorrected: unknown decisionId",
      "SeasonLedger.CallCorrected: unknown chip 255",
    ]);
  });

  it("replaying the chain, whole or block by block, changes nothing", async () => {
    const rows = await db.snapshot();
    const last = indexer.nextBlock - 1n;
    await indexer.replay(f.deployBlock, last);
    expect(await db.snapshot()).toEqual(rows);
    for (let block = f.deployBlock; block <= last; block++) await indexer.replay(block, block);
    expect(await db.snapshot()).toEqual(rows);
  }, 120_000);

  it("refuses a start block one past the deploy, by reading the chain's history", async () => {
    const { addresses, deployBlock, url } = f;
    const sources = [createChainSource(url, addresses)];
    const late = new Indexer({ db, sources, addresses, startBlock: deployBlock + 1n, log: memoryLog() });
    await expect(late.tick()).rejects.toThrow(/after the deploy/);
  });

  it("a restarted worker resumes, waits for confirmations, and catches up through startIndexer", async () => {
    await f.send(admin, "BotRegistry", "setActive", [IDS.carolBot, true]);
    const status = async () =>
      (await rowsOf(`select status::text as status from bots where id = ${IDS.carolBot}`))[0]!.status;

    const env = {
      ...Object.fromEntries(CONTRACT_NAMES.map((name) => [ADDRESS_ENV[name], f.addresses[name]])),
      INDEXER_START_BLOCK: f.deployBlock.toString(),
      DATABASE_URL: "postgres://localhost/unused",
    };
    const start = () => {
      const restartLog = memoryLog();
      const openDb = () => ({ ...db, close: async () => {} });
      return { restartLog, worker: startIndexer({ rpcUrls: [f.url], env, log: restartLog, openDb })! };
    };

    const before = start();
    await vi.waitFor(() => expect(before.restartLog.lines.map((l) => l.message)).toContain("resuming"), 20_000);
    await before.worker.stop();
    expect(await status()).toBe("banned"); // mined, but not confirmed
    const resumed = before.restartLog.lines.find((l) => l.message === "resuming")!.fields as { nextBlock: bigint };
    expect(resumed.nextBlock).toBeGreaterThan(f.deployBlock);

    await f.confirm(CONFIRMATIONS);
    const after = start();
    await vi.waitFor(async () => expect(await status()).toBe("active"), 20_000);
    await after.worker.stop();
  }, 60_000);
});
