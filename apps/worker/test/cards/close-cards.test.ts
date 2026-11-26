import type { PGlite } from "@electric-sql/pglite";
import {
  istDay,
  type BattleCardPayload,
  type CallCardPayload,
  type CardPayload,
  type ChallengeCardPayload,
  type EvolutionCardPayload,
  type SeasonCardPayload,
} from "@botfolio/shared";
import type { Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CardChain } from "../../src/cards/build";
import { sweepCloseCards } from "../../src/cards/close-cards";
import type { CardDeps } from "../../src/cards/slot-cards";
import type { Queryable } from "../../src/scheduler/db";
import { testDb } from "../decisions/helpers";

const E8 = 100_000_000n;
const START = 1000n * E8;
const BTC = 9_000_000_000_000n;
const ist = (time: string) => new Date(`${time}+05:30`);
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const ROOT_TX = tx(0xc105e);
const SETTLE_TX = tx(0x5e771e);

let pg: PGlite;
let db: Queryable;
let clock: Date;
let settled: Hex | null;
const chain: CardChain = {
  startCashE8: async () => START,
  blockTime: async () => new Date("2026-11-27T04:00:00Z"),
  roundUpdatedAt: async () => new Date("2026-11-27T03:50:00Z"),
  txTime: async () => new Date("2026-11-27T05:00:00Z"),
  challengeSettledTx: async () => settled,
};
const deps = (): CardDeps => ({ db, chain, log: { info() {}, warn() {} }, now: () => clock });
async function card<T extends CardPayload>(id: string): Promise<T | undefined> {
  const { rows } = await pg.query<{ payload: T }>("select payload from cards where id = $1", [id]);
  return rows[0]?.payload;
}
const count = async () => (await pg.query<{ n: number }>("select count(*)::int as n from cards")).rows[0]!.n;

let slotId: string;
beforeEach(async () => {
  ({ pg, db } = await testDb()); // bots 7 and 8
  settled = SETTLE_TX;
  await pg.exec(`
    update bots set name = 'AlphaWolf' where id = 7;
    insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash, is_house) values
      (90, '0x${"9".repeat(40)}', 'Steady Sam', 's', '', decode(repeat('00', 32), 'hex'), true),
      (91, '0x${"9".repeat(39)}1', 'Gold Granny', 'g', '', decode(repeat('00', 32), 'hex'), true),
      (92, '0x${"9".repeat(39)}2', 'Momentum Max', 'm', '', decode(repeat('00', 32), 'hex'), true);`);
  await pg.query(
    "insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades, status, root_tx) values (1, $1, $2, 'sprint', 8, 'closed', $3)",
    [ist("2026-11-26T00:00:00"), ist("2026-11-27T21:30:00"), ROOT_TX],
  );
  const { rows } = await pg.query<{ id: string }>("insert into slots (slot_time, kind, season_id) values ($1, 'scheduled', 1) returning id::text as id", [ist("2026-11-27T21:00:00")]);
  slotId = rows[0]!.id;
  await pg.query("insert into oracle_reads (slot_id, asset, feed, round_id, answer, updated_at, fresh) values ($1, 'BTC', $2, 50, $3, $4, true)", [
    slotId, `0x${"f".repeat(40)}`, BTC.toString(), ist("2026-11-27T20:55:00"),
  ]);
  const results: [number, number, number, number | null][] = [[7, 500, 300, 2], [8, -200, 900, 4], [90, 800, 100, null], [91, 100, 50, null], [92, -50, 400, null]];
  for (const [bot, ret, dd, rank] of results) {
    await pg.query("insert into portfolio_marks (bot_id, slot_id, cash_e8, holdings, value_e8) values ($1, $2, 0, '{\"BTC\": {}}', $3)", [bot, slotId, (1000n * E8 + BigInt(ret) * 10n * E8 / 100n).toString()]);
    await pg.query(
      "insert into season_results (season_id, bot_id, start_value_e8, end_value_e8, return_bps, max_dd_bps, trades, battle_rank) values (1, $1, $2, $3, $4, $5, 2, $6)",
      [bot, START.toString(), (START + BigInt(ret) * START / 10_000n).toString(), ret, dd, rank],
    );
  }
  // Bot 7's two trades this season: a BUY at 88k (+227 bps at 90k) and a BUY at 92k (−217 bps).
  const { rows: d } = await pg.query<{ id: string }>(
    `insert into decisions (bot_id, version, slot_id, prompt_version, model, input_json, input_hash, reason, status)
     values (7, 1, $1, 'p', 'm', '{}', decode(repeat('00', 32), 'hex'), 'BTC please.', 'executed') returning id::text as id`,
    [slotId],
  );
  for (const [i, price] of [8_800_000_000_000n, 9_200_000_000_000n].entries()) {
    await pg.query(
      `insert into trades (decision_id, action_index, order_id, bot_id, asset, side, cash_e8, units_e18, price_e8, round_id, tx_hash, log_index, block_number)
       values ($1, $2, decode($3, 'hex'), 7, 'BTC', 'BUY', 1, 1, $4, 40, $5, $2, 10)`,
      [d[0]!.id, i, (i + 1).toString(16).padStart(64, "0"), price.toString(), tx(i + 1)],
    );
  }
  clock = ist("2026-11-27T21:40:00");
}, 30_000);
afterEach(() => pg.close());

describe("season-close cards", () => {
  it("battle and season cards for each raised bot, citing the close", async () => {
    await sweepCloseCards(deps());
    const battle = (await card<BattleCardPayload>("battle-7-s1"))!;
    expect(battle).toMatchObject({ kind: "battle", seasonId: 1, change: { bps: 500, since: "season" }, battle: { rank: 2 } });
    expect(battle.battle.entries.map((e) => [e.bot.botId, e.rank, e.returnBps])).toEqual([["90", 1, 800], ["7", 2, 500], ["91", 3, 100], ["92", 4, -50]]);
    expect(battle.cites).toEqual([expect.objectContaining({ event: "season_closed", txHash: ROOT_TX, oracle: null })]);

    const season = (await card<SeasonCardPayload>("season-7-s1"))!;
    expect(season.season).toMatchObject({ returnBps: 500, maxDdBps: 300, trades: 2, best: { pnlBps: 227, txHash: tx(1) }, worst: { pnlBps: -217, txHash: tx(2) } });
    expect(season.cites.map((c) => c.txHash)).toEqual([ROOT_TX, tx(1), tx(2)]);
    expect(await card("battle-8-s1")).toBeDefined();
    expect(await card("battle-90-s1")).toBeUndefined(); // house bots get none

    const made = await count();
    expect(await sweepCloseCards(deps())).toBe(0);
    expect(await count()).toBe(made);
  });

  it("no battle card without exactly three house bots, but still a season card", async () => {
    await pg.exec("delete from season_results where bot_id = 92");
    await sweepCloseCards(deps());
    expect(await card("battle-7-s1")).toBeUndefined();
    expect(await card("season-7-s1")).toBeDefined();
  });

  it("the hidden S0 gets no battle, season or challenge cards, and its trust score is not shown (#219)", async () => {
    await pg.query(
      "insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades, status, root_tx) values (0, $1, $2, 'sprint', 8, 'closed', $3)",
      [ist("2026-11-25T00:00:00"), ist("2026-11-25T21:30:00"), ROOT_TX],
    );
    await pg.exec(`
      insert into slots (slot_time, kind, season_id) values ('2026-11-25T21:00:00+05:30', 'scheduled', 0);
      insert into portfolio_marks (bot_id, slot_id, cash_e8, holdings, value_e8)
        select b, (select id from slots where season_id = 0), 0, '{}', 100000000000 from unnest(array[7, 8, 90, 91, 92]) b;
      insert into season_results (season_id, bot_id, start_value_e8, end_value_e8, return_bps, max_dd_bps, trades, battle_rank)
        select 0, bot_id, start_value_e8, end_value_e8, return_bps, max_dd_bps, trades, battle_rank from season_results where season_id = 1;
      insert into trust_scores (season_id, bot_id, rules_version, f_rules, f_drawdown, f_consistency, f_explains, total, provisional, leaf_hash)
        values (0, 7, 'trust-v1-sprint', 100, 100, 100, 100, 400, true, decode(repeat('00', 32), 'hex'));
      insert into challenges (code, season_id, challenger_bot, opponent_bot, status, winner_bot) values ('0x${"ef".repeat(32)}', 0, 7, 8, 'settled', 7);`);
    await sweepCloseCards(deps());
    const { rows } = await pg.query<{ id: string }>("select id from cards where id like '%-s0' or id like 'challenge-%'");
    expect(rows).toEqual([]);
    expect((await card<SeasonCardPayload>("season-7-s1"))!.trust).toBeNull();
  });

  it("a pass skips bots whose cards exist and builds only the missing one", async () => {
    await sweepCloseCards(deps());
    let tradeReads = 0;
    const counting = {
      query: (text: string, values?: unknown[]) => {
        if (text.includes("from trades t")) tradeReads++;
        return db.query(text, values);
      },
    } as Queryable;
    const withCount = (): CardDeps => ({ ...deps(), db: counting });
    expect(await sweepCloseCards(withCount())).toBe(0);
    expect(tradeReads).toBe(0);

    await pg.exec("delete from cards where id = 'battle-7-s1'");
    expect(await sweepCloseCards(withCount())).toBe(1);
    expect(await card("battle-7-s1")).toBeDefined();
    expect(tradeReads).toBe(0); // the season card exists, so its trades aren't re-read
  });
});

describe("evolution cards", () => {
  async function commitV2(config: object, coin = 2000) {
    await pg.query(
      `insert into bot_versions (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source, committed_tx, approved_at)
       values (7, 2, 'Smaller bites.', $1, 4, $2, decode(repeat('ab', 32), 'hex'), 'season_v2', $3, $4)`,
      [coin, JSON.stringify(config), tx(0xe0), ist("2026-11-28T07:00:00")],
    );
  }

  it("shows the diff and the corrections behind it, citing the commit", async () => {
    const { rows: d } = await pg.query<{ id: string }>("select id::text as id from decisions limit 1");
    const ids: number[] = [];
    for (const chip of ["too risky", "too risky", "too timid"]) {
      const { rows } = await pg.query<{ id: number }>(
        `insert into corrections (bot_id, decision_id, user_wallet, chip, tx_hash, created_at) values (7, $1, '0x${"0".repeat(39)}7', $2, $3, $4) returning id::int as id`,
        [d[0]!.id, chip, tx(0xc0 + ids.length), ist("2026-11-26T12:00:00")],
      );
      ids.push(rows[0]!.id);
    }
    await commitV2({ season: 1, changes: [{ what: "You said 'too risky' 2× → max per coin 25 % → 20 %", because_correction_id: ids[0] }] });

    await sweepCloseCards(deps());
    const evo = (await card<EvolutionCardPayload>("evolution-7-v2"))!;
    expect(evo.evolution).toMatchObject({ fromVersion: 1, toVersion: 2, configHash: `0x${"ab".repeat(32)}`, txHash: tx(0xe0) });
    expect(evo.evolution.changes).toEqual([
      { setting: "max_per_coin_bps", from: 2500, to: 2000, because: { source: "corrections", chip: "too risky", count: 2 } },
      { setting: "rules", what: "You said 'too risky' 2× → max per coin 25 % → 20 %", because: { source: "corrections", chip: "too risky", count: 2 } },
    ]);
    expect(evo.cites).toEqual([expect.objectContaining({ event: "version_committed", txHash: tx(0xe0) })]);
  });

  it("a version committed without our proposal still gets a card, from the results", async () => {
    await commitV2({ max_per_coin_bps: 3000, max_trades_per_day: 4 }, 3000);
    await pg.exec("update bot_versions set rules_text = '' where version = 2");
    await sweepCloseCards(deps());
    expect((await card<EvolutionCardPayload>("evolution-7-v2"))!.evolution.changes).toEqual([
      { setting: "max_per_coin_bps", from: 2500, to: 3000, because: { source: "season_result", text: "From the season's results" } },
    ]);
  });
});

describe("challenge cards", () => {
  beforeEach(async () => {
    await pg.query(
      "insert into challenges (code, season_id, challenger_bot, opponent_bot, status, winner_bot) values ($1, 1, 7, 8, 'settled', 7)",
      [`0x${"cd".repeat(32)}`],
    );
  });

  it("one per side, once the settle tx is found on-chain", async () => {
    settled = null;
    await sweepCloseCards(deps());
    expect(await card(`challenge-${"cd".repeat(8)}-7`)).toBeUndefined();

    settled = SETTLE_TX;
    await sweepCloseCards(deps());
    const mine = (await card<ChallengeCardPayload>(`challenge-${"cd".repeat(8)}-7`))!;
    expect(mine.challenge).toMatchObject({
      winnerBotId: "7",
      txHash: SETTLE_TX,
      challenger: { bot: { botId: "7" }, returnBps: 500, maxDdBps: 300 },
      opponent: { bot: { botId: "8" }, returnBps: -200 },
    });
    expect(mine.cites.map((c) => c.txHash)).toEqual([SETTLE_TX, ROOT_TX]);
    expect(await card(`challenge-${"cd".repeat(8)}-8`)).toBeDefined();
  });
});

describe("call cards", () => {
  it("the result with the season's score and the owner's streak, citing call and settle", async () => {
    const day1 = istDay(Math.floor(ist("2026-11-26T12:00:00").getTime() / 1000));
    const calls: [number, boolean, boolean][] = [[day1, true, true], [day1 + 1, true, false]];
    for (const [i, [day, user, bot]] of calls.entries()) {
      await pg.query(
        `insert into daily_calls (bot_id, day, user_up, bot_up, bot_up_sig, price_at_call_e8, round_at_call, settle_price_e8, settle_round,
                                  user_correct, bot_correct, call_tx, settle_tx)
         values (7, $1, true, false, '\\x00', 1, 60, 2, 61, $2, $3, $4, $5)`,
        [day, user, bot, tx(0xa0 + i), tx(0xb0 + i)],
      );
    }
    await sweepCloseCards(deps());
    const c = (await card<CallCardPayload>(`call-7-${day1 + 1}`))!;
    expect(c).toMatchObject({ seasonId: 1 });
    expect(c.call).toMatchObject({
      day: day1 + 1,
      userUp: true,
      botUp: false,
      userCorrect: true,
      botCorrect: false,
      score: { user: 2, bot: 1 },
      streak: 2,
      callTxHash: tx(0xa1),
      settleTxHash: tx(0xb1),
      priceAtCall: { asset: "BTC", roundId: "60", readAt: "2026-11-27T05:00:00.000Z" },
    });
    expect(c.cites.map((x) => [x.event, x.txHash])).toEqual([["daily_call", tx(0xa1)], ["daily_call_settled", tx(0xb1)]]);
    expect(await card(`call-7-${day1}`)).toBeDefined();
  });
});

describe("createCardChain lookups", () => {
  it("finds the settle tx in 2000-block ranges after the close, and times a tx by its block", async () => {
    const { createCardChain } = await import("../../src/cards/build");
    const ranges: [bigint, bigint][] = [];
    const client = {
      getTransactionReceipt: async () => ({ blockNumber: 1000n }),
      getBlockNumber: async () => 6500n,
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: 1_800_000_000n + blockNumber }),
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        ranges.push([fromBlock, toBlock]);
        return fromBlock === 5000n ? [{ transactionHash: SETTLE_TX }] : [];
      },
    } as unknown as Parameters<typeof createCardChain>[0];
    const c = createCardChain(client, async () => START, `0x${"c".repeat(40)}`);
    expect(await c.challengeSettledTx(`0x${"cd".repeat(32)}`, ROOT_TX)).toBe(SETTLE_TX);
    expect(ranges).toEqual([[1000n, 2999n], [3000n, 4999n], [5000n, 6500n]]);
    expect(await c.txTime(ROOT_TX)).toEqual(new Date((1_800_000_000 + 1000) * 1000));
    expect(await createCardChain(client, async () => START, null).challengeSettledTx(`0x${"cd".repeat(32)}`, ROOT_TX)).toBeNull();
  });
});
