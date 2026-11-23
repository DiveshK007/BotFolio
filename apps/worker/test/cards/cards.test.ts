import type { PGlite } from "@electric-sql/pglite";
import { istDay, type CardPayload, type RecapCardPayload, type RoastCardPayload, type TradeCardPayload } from "@botfolio/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCardChain, saveCard, type CardChain } from "../../src/cards/build";
import { cardJobs, startCardSweeper } from "../../src/cards/jobs";
import { makeRecaps } from "../../src/cards/recap";
import { sweepSlotCards, type CardDeps } from "../../src/cards/slot-cards";
import type { Queryable } from "../../src/scheduler/db";
import { testDb } from "../decisions/helpers";

const E8 = 100_000_000n;
const START = 1000n * E8;
const ist = (time: string) => new Date(`${time}+05:30`);
const signal = new AbortController().signal;
const BTC = 9_000_000_000_000n; // 90,000.00000000
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

let pg: PGlite;
let db: Queryable;
let clock: Date;
const chain: CardChain = {
  startCashE8: async () => START,
  blockTime: async (block) => new Date(Date.UTC(2026, 10, 26, 3, 30) + Number(block) * 1000),
  roundUpdatedAt: async () => new Date("2026-11-26T03:00:00Z"),
  txTime: async () => new Date("2026-11-26T04:00:00Z"),
  challengeSettledTx: async () => null,
};
const deps = (): CardDeps => ({ db, chain, log: { info() {}, warn() {} }, now: () => clock });

async function slot(time: string, prices: Partial<Record<string, bigint>> = { BTC }): Promise<string> {
  const { rows } = await pg.query<{ id: string }>("insert into slots (slot_time, kind, season_id) values ($1, 'scheduled', 1) returning id::text as id", [ist(time)]);
  const id = rows[0]!.id;
  for (const [asset, answer] of Object.entries(prices)) {
    await pg.query(
      "insert into oracle_reads (slot_id, asset, feed, round_id, answer, updated_at, fresh) values ($1, $2, $3, $4, $5, $6, true)",
      [id, asset, `0x${"f".repeat(40)}`, 100 + Number(id), answer!.toString(), new Date(ist(time).getTime() - 600_000)],
    );
  }
  return id;
}
async function mark(botId: number, slotId: string, value: bigint, holdings: object = { BTC: { units_e18: "1", value_e8: "1" } }) {
  await pg.query("insert into portfolio_marks (bot_id, slot_id, cash_e8, holdings, value_e8) values ($1, $2, 0, $3, $4)", [botId, slotId, JSON.stringify(holdings), value.toString()]);
}
let orders = 0;
async function decision(botId: number, slotId: string, reason: string, roast = "", trades: { side: "BUY" | "SELL"; price: bigint; approved?: boolean }[] = []) {
  const { rows } = await pg.query<{ id: string }>(
    `insert into decisions (bot_id, version, slot_id, prompt_version, model, input_json, input_hash, reason, reason_tag, roast, status)
     values ($1, 1, $2, 'p', 'm', '{}', decode(repeat('00', 32), 'hex'), $3, 'trend_up', $4, 'executed') returning id::text as id`,
    [botId, slotId, reason, roast],
  );
  for (const [i, t] of trades.entries()) {
    orders++;
    const order = orders.toString(16).padStart(64, "0");
    await pg.query(
      `insert into trades (decision_id, action_index, order_id, bot_id, asset, side, cash_e8, units_e18, price_e8, round_id, tx_hash, log_index, block_number)
       values ($1, $2, decode($3, 'hex'), $4, 'BTC', $5, 100, 5, $6, 7, $7, $8, $9)`,
      [rows[0]!.id, i, order, botId, t.side, t.price.toString(), tx(orders), i, orders],
    );
    if (t.approved) {
      await pg.query(
        `insert into big_moves (decision_id, action_index, order_id, bot_id, asset, side, bps, runner_sig, deadline, status, user_tx)
         values ($1, $2, decode($3, 'hex'), $4, 'BTC', $5, 4000, '\\x00', now(), 'approved', $6)`,
        [rows[0]!.id, i, order, botId, t.side, tx(orders)],
      );
    }
  }
  return rows[0]!.id;
}
async function card<T extends CardPayload>(id: string): Promise<T | undefined> {
  const { rows } = await pg.query<{ payload: T }>("select payload from cards where id = $1", [id]);
  return rows[0]?.payload;
}

beforeEach(async () => {
  ({ pg, db } = await testDb()); // bots 7 and 8
  await pg.exec(`
    insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash, is_house)
    values (90, '0x${"9".repeat(40)}', 'Steady Sam', 's', '', decode(repeat('00', 32), 'hex'), true);
    update bots set name = 'AlphaWolf', emoji = '🐺' where id = 7;`);
  await pg.query("insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades) values (1, $1, $2, 'sprint', 8)", [ist("2026-11-26T00:00:00"), ist("2026-11-27T21:30:00")]);
  clock = ist("2026-11-26T21:35:00");
  orders = 0;
}, 30_000);
afterEach(() => pg.close());

describe("first-trade cards", () => {
  it("cards a bot's first trade once, citing it, with the price as the contract read it", async () => {
    const nine = await slot("2026-11-26T09:00:00");
    await decision(7, nine, "Starting with a little BTC.", "", [{ side: "BUY", price: BTC }]);
    await mark(7, nine, 1010n * E8);
    const thirteen = await slot("2026-11-26T13:00:00");
    await decision(7, thirteen, "More BTC.", "", [{ side: "BUY", price: BTC }]);
    await mark(7, thirteen, 1020n * E8);

    expect(await sweepSlotCards(deps())).toBe(1);
    const c = (await card<TradeCardPayload>("trade-7"))!;
    expect(c).toMatchObject({
      kind: "trade",
      bot: { botId: "7", name: "AlphaWolf", isHouse: false },
      seasonId: 1,
      value: { valueE8: (1010n * E8).toString(), startCashE8: START.toString(), markedAt: ist("2026-11-26T09:00:00").toISOString() },
      change: { bps: 100, since: "start" },
      line: { source: "reason", text: "Starting with a little BTC." },
      trade: { side: "BUY", approvedByOwner: false, txHash: tx(1), price: { asset: "BTC", roundId: "7", priceE8: BTC.toString() } },
    });
    expect(c.cites).toEqual([expect.objectContaining({ event: "trade", txHash: tx(1), oracle: { asset: "BTC", roundId: "7" } })]);
    expect(c.value.oldestPrice).toMatchObject({ asset: "BTC" });
    expect(await sweepSlotCards(deps())).toBe(0);
  });

  it("an allowed big move is cited as the owner's own trade", async () => {
    const nine = await slot("2026-11-26T09:00:00");
    await decision(7, nine, "Going big on BTC.", "", [{ side: "BUY", price: BTC, approved: true }]);
    await mark(7, nine, 1000n * E8);
    await sweepSlotCards(deps());
    const c = (await card<TradeCardPayload>("trade-7"))!;
    expect(c.trade.approvedByOwner).toBe(true);
    expect(c.cites[0]!.event).toBe("approved_trade");
  });
});

describe("slot-loss roast cards", () => {
  it("cards a loss of 3 % or more in one slot, with the bot's roast and the trades that lost", async () => {
    const a = await slot("2026-11-26T09:00:00");
    await decision(7, a, "All in on BTC.", "", [{ side: "BUY", price: BTC }]);
    await mark(7, a, 1000n * E8);
    const b = await slot("2026-11-26T13:00:00");
    await decision(7, b, "Holding BTC.", "Ouch, that one stung.");
    await mark(7, b, 960n * E8); // −4 %
    const c = await slot("2026-11-26T17:00:00");
    await decision(7, c, "Still holding BTC.", "");
    await mark(7, c, 940n * E8); // −2.08 %: not a roast
    // The house bot loses too, but gets no roast.
    await mark(90, a, 1000n * E8);
    await mark(90, b, 900n * E8);

    await sweepSlotCards(deps());
    const roast = (await card<RoastCardPayload>(`roast-7-${b}`))!;
    expect(roast).toMatchObject({
      kind: "roast",
      change: { bps: -400, deltaE8: (-40n * E8).toString(), since: "slot" },
      line: { source: "roast", text: "Ouch, that one stung." },
      roast: { trigger: "slot_loss", lossBps: 400, lossE8: (40n * E8).toString() },
    });
    expect(roast.cites.map((x) => x.txHash)).toEqual([tx(1)]);
    expect(await card(`roast-7-${c}`)).toBeUndefined();
    const { rows } = await pg.query<{ n: number }>("select count(*)::int as n from cards where bot_id = 90");
    expect(rows[0]!.n).toBe(0);
  });

  it("falls back to the reason when the slot's roast is empty", async () => {
    const a = await slot("2026-11-26T09:00:00");
    await decision(7, a, "All in on BTC.", "", [{ side: "BUY", price: BTC }]);
    await mark(7, a, 1000n * E8);
    const b = await slot("2026-11-26T13:00:00");
    await decision(7, b, "Holding my BTC through this.", "");
    await mark(7, b, 950n * E8);
    await sweepSlotCards(deps());
    expect((await card<RoastCardPayload>(`roast-7-${b}`))!.line).toMatchObject({ source: "reason", text: "Holding my BTC through this." });
  });
});

describe("daily recap cards", () => {
  it("one per active raised bot: today's change, best and worst call, season rank", async () => {
    const before = await slot("2026-11-25T21:00:00");
    await mark(7, before, 1000n * E8);
    const nine = await slot("2026-11-26T09:00:00", { BTC: 8_800_000_000_000n });
    await decision(7, nine, "Buying the BTC dip.", "", [{ side: "BUY", price: 8_800_000_000_000n }]);
    await mark(7, nine, 1000n * E8);
    const thirteen = await slot("2026-11-26T13:00:00", { BTC: 9_200_000_000_000n });
    await decision(7, thirteen, "Taking some BTC profit.", "", [{ side: "SELL", price: 9_200_000_000_000n }]);
    await mark(7, thirteen, 1030n * E8);
    const nine_pm = await slot("2026-11-26T21:00:00", { BTC: BTC });
    await decision(7, nine_pm, "Resting on my BTC.");
    await mark(7, nine_pm, 1020n * E8);
    // Bot 8 had a quiet day; bot 90 is a house bot.
    await mark(8, nine_pm, 1000n * E8, {});
    await mark(90, nine_pm, 1000n * E8);
    await pg.exec("insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash, status) values (11, '0x" + "1".repeat(40) + "', 'Sleepy', 'z', '', decode(repeat('00', 32), 'hex'), 'paused')");
    await mark(11, nine_pm, 1000n * E8);

    expect(await makeRecaps(deps(), signal)).toBe(2);
    const day = istDay(Math.floor(clock.getTime() / 1000));
    const recap = (await card<RecapCardPayload>(`recap-7-${day}`))!;
    expect(recap).toMatchObject({
      kind: "recap",
      seasonId: 1,
      change: { bps: 200, since: "day" },
      line: { source: "reason", text: "Resting on my BTC." },
      recap: { day, rank: { position: 1, of: 3 } }, // the paused bot is still on the board
    });
    // BUY at 88k → 90k is +227 bps; SELL at 92k → 90k is +217 bps.
    expect(recap.recap.best).toMatchObject({ side: "BUY", pnlBps: 227, txHash: tx(1) });
    expect(recap.recap.worst).toMatchObject({ side: "SELL", pnlBps: 217, txHash: tx(2) });
    expect(recap.cites.map((x) => x.txHash)).toEqual([tx(1), tx(2)]);

    const quiet = (await card<RecapCardPayload>(`recap-8-${day}`))!;
    expect(quiet).toMatchObject({ change: { bps: 0 }, cites: [], line: null, recap: { best: null, worst: null } });
    expect(quiet.value.oldestPrice).toBeNull(); // all cash
    expect(await card(`recap-90-${day}`)).toBeUndefined();
    expect(await card(`recap-11-${day}`)).toBeUndefined();

    expect(await makeRecaps(deps(), signal)).toBe(0);
  });

  it("between seasons a recap has no season", async () => {
    const last = await slot("2026-11-27T21:00:00");
    await mark(7, last, 1000n * E8, {});
    clock = ist("2026-11-27T21:35:00");
    await makeRecaps(deps(), signal);
    const day = istDay(Math.floor(clock.getTime() / 1000));
    expect((await card<RecapCardPayload>(`recap-7-${day}`))!.seasonId).toBeNull();
  });
});

it("refuses a card that shows a tx hash it doesn't cite", async () => {
  const bad = {
    schemaVersion: 1,
    kind: "trade",
    cardId: "trade-7",
    createdAt: clock.toISOString(),
    bot: { botId: "7", name: "A", emoji: "a", ownerAddress: `0x${"7".padStart(40, "0")}`, ownerQieName: null, isHouse: false },
    seasonId: 1,
    value: { valueE8: "1", startCashE8: "1", markedAt: clock.toISOString(), oldestPrice: null },
    change: { bps: 0, deltaE8: "0", since: "start" },
    trust: null,
    line: { source: "reason", decisionId: "d", text: "t" },
    cites: [],
    trade: { decisionId: "d", actionIndex: 0, side: "BUY", cashE8: "1", unitsE18: "1", price: { asset: "BTC", priceE8: "1", roundId: "1", updatedAt: "", readAt: "" }, approvedByOwner: false, txHash: tx(5) },
  } as TradeCardPayload;
  await expect(saveCard(db, bad)).rejects.toThrow("without citing it");
});

describe("wiring", () => {
  it("the recap job needs the ledger address; with it, it writes slot cards and recaps", async () => {
    expect(cardJobs({ db, log: { info() {}, warn() {} }, chain: null }).unavailable).toEqual({ recap: "needs PAPER_LEDGER_ADDRESS" });
    const nine = await slot("2026-11-26T09:00:00");
    await decision(7, nine, "Starting with a little BTC.", "", [{ side: "BUY", price: BTC }]);
    await mark(7, nine, 1000n * E8);
    const jobs = cardJobs({ db, log: { info() {}, warn() {} }, chain, now: () => clock });
    await jobs.handlers.recap!({ scheduledFor: clock, signal } as Parameters<NonNullable<typeof jobs.handlers.recap>>[0]);
    const { rows } = await pg.query<{ id: string }>("select id from cards order by id");
    expect(rows.map((r) => r.id)).toEqual([`recap-7-${istDay(Math.floor(clock.getTime() / 1000))}`, "trade-7"]);
  });

  it("the sweeper writes a first-trade card within its interval, and stops cleanly", async () => {
    const nine = await slot("2026-11-26T09:00:00");
    await decision(7, nine, "Starting with a little BTC.", "", [{ side: "BUY", price: BTC }]);
    await mark(7, nine, 1000n * E8);
    const stop = startCardSweeper({ db, chain, log: { info() {}, warn() {} }, intervalMs: 20, now: () => clock });
    for (let i = 0; i < 100 && !(await card("trade-7")); i++) await new Promise((r) => setTimeout(r, 20));
    await stop();
    expect(await card("trade-7")).toBeDefined();
  });

  it("chain lookups are read once and cached", async () => {
    let reads = 0;
    const client = {
      getBlock: async () => ((reads++, { timestamp: 1_800_000_000n })),
      readContract: async () => ((reads++, [1n, 2n, 3n, 1_799_999_000n, 1n])),
    } as unknown as Parameters<typeof createCardChain>[0];
    const c = createCardChain(client, async () => START);
    expect(await c.blockTime(5n)).toEqual(new Date(1_800_000_000_000));
    expect(await c.blockTime(5n)).toEqual(new Date(1_800_000_000_000));
    expect(await c.roundUpdatedAt("BTC", 9n)).toEqual(new Date(1_799_999_000_000));
    await c.roundUpdatedAt("BTC", 9n);
    expect(reads).toBe(2);
  });
});
