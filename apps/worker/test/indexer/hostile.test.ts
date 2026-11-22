import { describe, expect, it } from "vitest";
import { padHex, toHex, zeroHash, type Hex } from "viem";
import { decisionIdFromUuid } from "@botfolio/shared";
import type { EventArgs } from "../../src/indexer/handlers/types";
import { CONFIRMATIONS } from "../../src/indexer/indexer";
import { ADDRESSES } from "./helpers/fake-chain";
import { hash, seedBot, seedDecision } from "./helpers/seed";
import {
  ALICE,
  BOB,
  BOBS_DECISION,
  BOBS_PERSONA,
  CODE,
  DAY,
  DECISION,
  PERSONA,
  UINT256_MAX,
  trade,
  useWorld,
} from "./helpers/world";

// Anyone can call the contracts directly, with any values they like.
const w = useWorld();
const decisionId = decisionIdFromUuid(DECISION);
const count = async (table: string) =>
  (await w.db.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n;

async function seedTwoBots() {
  await seedBot(w.db, { id: 1n, owner: ALICE, personaHash: PERSONA });
  await seedBot(w.db, { id: 2n, owner: BOB, personaHash: BOBS_PERSONA });
  await seedDecision(w.db, DECISION, 1n);
  await seedDecision(w.db, BOBS_DECISION, 2n);
}

const correction = (
  over: Partial<EventArgs<"SeasonLedger", "CallCorrected">>,
): EventArgs<"SeasonLedger", "CallCorrected"> => ({ botId: 1n, decisionId, noteHash: zeroHash, chip: 0, season: 0, ...over });

/** The bad event, then a good one in the same tx and a good one in the next block. Both must land. */
async function indexesPast(reason: RegExp, emitBad: (tx: ReturnType<typeof w.chain.tx>) => void) {
  const tx = w.chain.tx();
  emitBad(tx);
  w.chain.emit(tx, "SeasonLedger", "CallCorrected", correction({ noteHash: hash(0x600d) }));
  w.chain.emit(w.chain.tx(), "PaperLedger", "Trade", trade());
  const indexer = await w.index();

  expect(indexer.nextBlock).toBe(w.chain.head - CONFIRMATIONS + 1n);
  expect(await count("trades")).toBe(1);
  expect(await count("corrections where note_hash = '\\x" + hash(0x600d).slice(2) + "'")).toBe(1);
  const [problem, ...others] = w.log.problems();
  expect(others).toEqual([]);
  expect(problem).toMatchObject({ txHash: tx.hash, logIndex: 0, reason: expect.stringMatching(reason) });
  return problem!;
}

describe("CallCorrected carries whatever decisionId the user signed", () => {
  it.each<[string, Hex, RegExp]>([
    ["a uuid with no decisions row (the FK)", decisionIdFromUuid("11111111-2222-4333-8444-555555555555"), /unknown decisionId/],
    ["all zeroes", zeroHash, /unknown decisionId/],
    ["not a padded uuid", toHex(UINT256_MAX), /not a padded uuid/],
    ["a right-padded uuid", padHex(`0x${DECISION.replaceAll("-", "")}`, { dir: "right", size: 32 }), /not a padded uuid/],
    ["another bot's decision", decisionIdFromUuid(BOBS_DECISION), /another bot/],
  ])("%s", async (_what, id, reason) => {
    await seedTwoBots();
    const problem = await indexesPast(reason, (tx) =>
      w.chain.emit(tx, "SeasonLedger", "CallCorrected", correction({ decisionId: id })),
    );
    expect(problem).toMatchObject({ kind: "skipped", event: "SeasonLedger.CallCorrected" });
    expect(await count("corrections")).toBe(1);
  });

  it("an unknown chip", async () => {
    await seedTwoBots();
    await indexesPast(/unknown chip 255/, (tx) =>
      w.chain.emit(tx, "SeasonLedger", "CallCorrected", correction({ chip: 255 })),
    );
  });

  it("a hundred of them in one block", async () => {
    await seedTwoBots();
    const tx = w.chain.tx();
    for (let i = 1; i <= 100; i++) {
      w.chain.emit(tx, "SeasonLedger", "CallCorrected", correction({ decisionId: padHex(toHex(i), { size: 32 }) }));
    }
    w.chain.emit(w.chain.tx(), "PaperLedger", "Trade", trade());
    await w.index();
    expect(await count("trades")).toBe(1);
    expect(w.log.problems()).toHaveLength(100);
  });
});

describe("values the schema can't hold", () => {
  it("a botId beyond bigint is refused, not wrapped", async () => {
    await seedTwoBots();
    await indexesPast(/database 22003/, (tx) =>
      w.chain.emit(tx, "PaperLedger", "Trade", { ...trade({ botId: UINT256_MAX }), actionIndex: 1 }),
    );
  });

  it("an actionIndex over the CHECK", async () => {
    await seedTwoBots();
    await indexesPast(/database 23514/, (tx) => w.chain.emit(tx, "PaperLedger", "Trade", { ...trade(), actionIndex: 255 }));
  });

  it("a timestamp beyond timestamptz", async () => {
    await seedTwoBots();
    await w.db.query(
      "insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades) values (0, now(), now() + interval '1 day', 'sprint', 8)",
    );
    await indexesPast(/database 22/, (tx) =>
      w.chain.emit(tx, "SeasonLedger", "SeasonOpened", { n: 0, start: 2n ** 63n, end: 2n ** 64n - 1n }),
    );
  });

  it("a season number beyond int", async () => {
    await seedTwoBots();
    await indexesPast(/database 22003/, (tx) =>
      w.chain.emit(tx, "Challenges", "ChallengeCreated", { code: CODE, myBot: 1n, season: 2 ** 32 - 1 }),
    );
  });

  it("an event that breaks a CHECK doesn't leave half of itself behind", async () => {
    await seedTwoBots();
    // BotCreated writes bots, then bot_versions. The second statement fails here.
    await indexesPast(/database 23514/, (tx) =>
      w.chain.emit(tx, "BotRegistry", "BotCreated", {
        botId: 3n,
        owner: BOB,
        personaHash: BOBS_PERSONA,
        maxPerCoinBps: 60_000,
        maxTradesPerDay: 4,
      }),
    );
    expect(await count("bots")).toBe(2);
  });

  it("a log that doesn't decode", async () => {
    await seedTwoBots();
    await indexesPast(/unreadable log/, (tx) => {
      const log = w.chain.emit(tx, "PaperLedger", "Trade", trade());
      log.data = "0x1234";
    });
  });
});

describe("rows someone else writes are missing", () => {
  it("a Trade with no decision waits for it", async () => {
    await seedTwoBots();
    const problem = await indexesPast(/no decisions row/, (tx) =>
      w.chain.emit(tx, "PaperLedger", "Trade", {
        ...trade(),
        decisionId: decisionIdFromUuid("11111111-2222-4333-8444-555555555555"),
      }),
    );
    expect(problem.kind).toBe("waiting");
  });

  it("a Trade on another bot's decision is never stored", async () => {
    await seedTwoBots();
    await indexesPast(/another bot/, (tx) =>
      w.chain.emit(tx, "PaperLedger", "Trade", { ...trade({ botId: 2n }), actionIndex: 1 }),
    );
  });

  it("a challenge for a season that isn't seeded", async () => {
    await seedTwoBots();
    const problem = await indexesPast(/no seasons/, (tx) =>
      w.chain.emit(tx, "Challenges", "ChallengeCreated", { code: CODE, myBot: 1n, season: 9 }),
    );
    expect(problem.kind).toBe("waiting");
  });

  it("a settlement with no call", async () => {
    await seedTwoBots();
    await indexesPast(/no indexed call/, (tx) =>
      w.chain.emit(tx, "DailyCall", "Settled", {
        botId: 2n,
        day: DAY,
        price: 1n,
        roundId: 1n,
        userCorrect: true,
        botCorrect: true,
      }),
    );
  });
});

describe("events only from our configured addresses", () => {
  const strangers = {
    "an unknown contract": padHex("0xbad", { size: 20 }),
    "the wrong one of our own contracts": ADDRESSES.Challenges,
  };

  it("a forged Trade from an unknown contract writes nothing, even if the RPC hands it to us", async () => {
    await seedTwoBots();
    const before = await w.db.snapshot();
    w.chain.emit(w.chain.tx(), "PaperLedger", "Trade", trade(), strangers["an unknown contract"]);
    await w.index();
    expect(await w.db.snapshot()).toEqual(before);
    expect(w.log.problems()).toEqual([]);
  });

  it("a forged Trade from the wrong one of our own contracts writes nothing", async () => {
    await seedTwoBots();
    const before = await w.db.snapshot();
    w.chain.emit(w.chain.tx(), "PaperLedger", "Trade", trade(), strangers["the wrong one of our own contracts"]);
    await w.index();
    expect(await w.db.snapshot()).toEqual(before);
    expect(w.log.problems()).toMatchObject([{ event: "Challenges", reason: expect.stringMatching(/unreadable/) }]);
  });

  it("accepts our address in any letter case", async () => {
    await seedTwoBots();
    w.chain.emit(w.chain.tx(), "PaperLedger", "Trade", trade(), `0x${ADDRESSES.PaperLedger.slice(2).toUpperCase()}`);
    await w.index();
    expect(await count("trades")).toBe(1);
  });
});

it("writes addresses and hashes in lowercase whatever case the RPC uses", async () => {
  await seedTwoBots();
  const tx = w.chain.tx();
  tx.hash = `0x${"AB".repeat(32)}`;
  w.chain.emit(tx, "PaperLedger", "Trade", trade());
  await w.index();
  expect((await w.db.query("select tx_hash from trades")).rows).toEqual([{ tx_hash: `0x${"ab".repeat(32)}` }]);
});
