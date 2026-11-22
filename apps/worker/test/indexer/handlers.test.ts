import { describe, expect, it } from "vitest";
import { keccak256, stringToHex, zeroHash } from "viem";
import { decisionIdFromUuid, orderIdOf } from "@botfolio/shared";
import { CHIPS } from "../../src/indexer/handlers/season-ledger";
import { timeOf } from "./helpers/fake-chain";
import {
  hash,
  seedBigMove,
  seedBot,
  seedBotView,
  seedDecision,
  seedPendingCorrection,
  seedRelay,
  seedSeason,
} from "./helpers/seed";
import {
  ALICE,
  BOB,
  BOBS_PERSONA,
  CODE,
  DAY,
  DECISION,
  PERSONA,
  RULES,
  UINT256_MAX,
  UINT80_MAX,
  trade,
  useWorld,
} from "./helpers/world";

const w = useWorld();
const decisionId = decisionIdFromUuid(DECISION);
const one = async (sql: string) => (await w.db.query(sql)).rows[0];

async function seedAliceWithDecision() {
  await seedBot(w.db, { id: 1n, owner: ALICE, personaHash: PERSONA });
  await seedDecision(w.db, DECISION, 1n);
}

describe("BotRegistry", () => {
  const BOT = `select id::text as id, owner_wallet, name, emoji, persona_text, encode(persona_hash, 'hex') as hash,
    extract(epoch from created_at)::bigint::text as created, created_tx, is_house, status::text as status from bots`;

  it("BotCreated writes the bot and its version 1", async () => {
    const tx = w.createBot();
    await w.index();

    expect(await one(BOT)).toEqual({
      id: "1",
      owner_wallet: ALICE,
      name: "Bot #1",
      emoji: "",
      persona_text: "",
      hash: PERSONA.slice(2),
      created: timeOf(tx.block).toString(),
      created_tx: tx.hash,
      is_house: false,
      status: "active",
    });
    expect(
      await one(`select version, rules_text, max_per_coin_bps, max_trades_per_day, config_json,
                 encode(config_hash, 'hex') as hash, source::text as source, committed_tx from bot_versions`),
    ).toEqual({
      version: 1,
      rules_text: "",
      max_per_coin_bps: 4000,
      max_trades_per_day: 4,
      config_json: { max_per_coin_bps: 4000, max_trades_per_day: 4 },
      hash: PERSONA.slice(2),
      source: "create",
      committed_tx: tx.hash,
    });
  });

  it("stores a checksummed owner in lowercase", async () => {
    w.createBot(1n, "0x9E596d809a20A272c788726f592c0d1629755440");
    await w.index();
    expect(await one("select owner_wallet from bots")).toEqual({
      owner_wallet: "0x9e596d809a20a272c788726f592c0d1629755440",
    });
  });

  it("reads the house flag from the contract, because the event has none", async () => {
    w.createBot();
    w.chain.setBot(1n, { house: true });
    await w.index();
    expect(await one("select is_house from bots")).toEqual({ is_house: true });
  });

  it("confirms an optimistic row and keeps its name and text", async () => {
    await seedBot(w.db, { id: 1n, owner: ALICE, personaHash: PERSONA });
    const tx = w.createBot();
    await w.index();

    expect(await one(BOT)).toMatchObject({ name: "GoldGuru", emoji: "G", persona_text: "Loves gold.", created_tx: tx.hash });
    expect(await one("select rules_text, config_json from bot_versions")).toEqual({
      rules_text: "Buy gold on dips.",
      config_json: { style: "careful" },
    });
  });

  it.each([
    ["the owner's", ALICE, "AlphaWolf", "Buys strength."],
    ["somebody else's", BOB, "Bot #1", ""],
  ])("without a pending row, %s draft for that hash gives name %s", async (_whose, wallet, name, rules) => {
    const draft = { name: "AlphaWolf", emoji: "W", persona: "Bold.", rules: "Buys strength." };
    await w.db.query("insert into users (wallet_address, terms_accepted_at, flags) values ($1, now(), $2::jsonb)", [
      wallet,
      JSON.stringify({ personas: { [PERSONA]: draft } }),
    ]);
    w.createBot();
    await w.index();

    expect(await one("select name from bots")).toEqual({ name });
    expect(await one("select rules_text from bot_versions")).toEqual({ rules_text: rules });
  });

  it.each([
    ["another owner", BOB, PERSONA],
    ["another persona", ALICE, BOBS_PERSONA],
  ])("drops an optimistic row's text when the chain gave that id to %s", async (_what, owner, persona) => {
    await seedBot(w.db, { id: 1n, owner, personaHash: persona });
    w.createBot();
    await w.index();

    expect(await one(BOT)).toMatchObject({ owner_wallet: ALICE, name: "Bot #1", emoji: "", persona_text: "" });
    expect(await one("select rules_text from bot_versions")).toEqual({ rules_text: "" });
  });

  it.each([
    ["paused", { active: false, banned: false }],
    ["banned", { active: false, banned: true }],
  ])("BotActiveChanged(false) becomes %s from the registry's own state", async (status, state) => {
    w.createBot();
    const tx = w.chain.tx();
    w.chain.emit(tx, "BotRegistry", "BotActiveChanged", { botId: 1n, active: false });
    w.chain.setBot(1n, state);
    await w.index();
    expect(await one("select status::text as status from bots")).toEqual({ status });
  });

  it("goes back to active", async () => {
    w.createBot();
    for (const active of [false, true]) {
      w.chain.emit(w.chain.tx(), "BotRegistry", "BotActiveChanged", { botId: 1n, active });
      w.chain.setBot(1n, { active });
    }
    await w.index();
    expect(await one("select status::text as status from bots")).toEqual({ status: "active" });
  });
});

describe("PaperLedger", () => {
  const TRADE = `select decision_id::text as decision, action_index, encode(order_id, 'hex') as order_id,
    bot_id::text as bot, asset::text as asset, side::text as side, cash_e8::text as cash, units_e18::text as units,
    price_e8::text as price, round_id::text as round, tx_hash, log_index, block_number::text as block from trades`;

  it("Trade writes every column, keyed by orderId", async () => {
    await seedAliceWithDecision();
    w.createBot();
    const tx = w.chain.tx();
    w.chain.emit(tx, "PaperLedger", "Trade", trade());
    await w.index();

    expect(await one(TRADE)).toEqual({
      decision: DECISION,
      action_index: 0,
      order_id: orderIdOf(decisionId, 0).slice(2),
      bot: "1",
      asset: "GOLD",
      side: "BUY",
      cash: "2500000000000",
      units: "6700000000000000000",
      price: "373084000000",
      round: "14811",
      tx_hash: tx.hash,
      log_index: 0,
      block: tx.block.toString(),
    });
  });

  it.each(["BTC", "ETH", "SOL", "XRP", "GOLD"].map((id, index) => [index, id] as const))(
    "asset %i is %s",
    async (asset, id) => {
      await seedAliceWithDecision();
      w.chain.emit(w.chain.tx(), "PaperLedger", "Trade", { ...trade(), asset, buy: false });
      await w.index();
      expect(await one(TRADE)).toMatchObject({ asset: id, side: "SELL" });
    },
  );

  it("loses no digit of the largest uints", async () => {
    await seedAliceWithDecision();
    w.chain.emit(
      w.chain.tx(),
      "PaperLedger",
      "Trade",
      trade({ cashE8: UINT256_MAX, unitsE18: UINT256_MAX - 1n, priceE8: 2n ** 53n + 1n, roundId: UINT80_MAX }),
    );
    await w.index();

    expect(await one(TRADE)).toMatchObject({
      cash: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      units: "115792089237316195423570985008687907853269984665640564039457584007913129639934",
      price: "9007199254740993",
      round: "1208925819614629174706175",
    });
  });

  it("replaces an optimistic row with what the chain says", async () => {
    await seedAliceWithDecision();
    await w.db.query(
      `insert into trades (decision_id, action_index, order_id, bot_id, asset, side, cash_e8, units_e18, price_e8, round_id)
       values ('${DECISION}', 0, '\\x${orderIdOf(decisionId, 0).slice(2)}', 1, 'BTC', 'SELL', 1, 1, 1, 1)`,
    );
    const tx = w.chain.tx();
    w.chain.emit(tx, "PaperLedger", "Trade", trade());
    await w.index();

    const { rows } = await w.db.query(TRADE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ asset: "GOLD", side: "BUY", cash: "2500000000000", tx_hash: tx.hash });
  });

  it("ApprovedTrade marks the big move approved, so /stats counts it as the user's and not the system's", async () => {
    await seedAliceWithDecision();
    await seedBigMove(w.db, { decision: DECISION, actionIndex: 0, botId: 1n });
    const tx = w.chain.tx();
    w.chain.emit(tx, "PaperLedger", "Trade", trade());
    w.chain.emit(tx, "PaperLedger", "ApprovedTrade", { botId: 1n, decisionId, actionIndex: 0, owner: ALICE });
    await w.index();

    expect(await one("select status::text as status, user_tx from big_moves")).toEqual({
      status: "approved",
      user_tx: tx.hash,
    });
    expect(await one("select system_trade_txs::int as n from site_activity_stats")).toEqual({ n: 0 });
  });

  it("OrderSkipped writes nothing and is not a problem", async () => {
    const tx = w.chain.tx();
    w.chain.emit(tx, "PaperLedger", "OrderSkipped", { botId: 1n, asset: 4, decisionId, actionIndex: 0, reason: 0 });
    const before = await w.db.snapshot();
    await w.index();
    expect(await w.db.snapshot()).toEqual(before);
    expect(w.log.problems()).toEqual([]);
  });
});

describe("SeasonLedger versions", () => {
  const V2 = hash(0x2222);
  const VERSION_2 = `select rules_text, max_per_coin_bps, max_trades_per_day, config_json, encode(config_hash, 'hex') as hash,
    source::text as source, committed_tx, extract(epoch from approved_at)::bigint::text as approved
    from bot_versions where version = 2`;

  function commitV2() {
    const tx = w.chain.tx();
    w.chain.emit(tx, "SeasonLedger", "VersionCommitted", { botId: 1n, version: 2, hash: V2, season: 0 });
    w.chain.emit(tx, "BotRegistry", "BotLimitsChanged", { botId: 1n, version: 2, maxPerCoinBps: 2500, maxTradesPerDay: 2 });
    return tx;
  }

  async function propose(configHash: string) {
    await seedBot(w.db, { id: 1n, owner: ALICE, personaHash: PERSONA });
    await w.db.query(
      `insert into bot_versions (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source)
       values (1, 2, 'Less gold.', 3000, 3, '{"proposal":true}', '\\x${configHash.slice(2)}', 'season_v2')`,
    );
  }

  it("takes the limits from BotLimitsChanged in the same tx", async () => {
    w.createBot();
    const tx = commitV2();
    await w.index();

    expect(await one(VERSION_2)).toEqual({
      rules_text: "",
      max_per_coin_bps: 2500,
      max_trades_per_day: 2,
      config_json: { max_per_coin_bps: 2500, max_trades_per_day: 2 },
      hash: V2.slice(2),
      source: "season_v2",
      committed_tx: tx.hash,
      approved: timeOf(tx.block).toString(),
    });
  });

  it("keeps a proposal's text under the hash it was proposed with", async () => {
    await propose(V2);
    commitV2();
    await w.index();
    expect(await one(VERSION_2)).toMatchObject({ rules_text: "Less gold.", config_json: { proposal: true } });
  });

  it("drops a proposal's text when the owner signed another hash", async () => {
    await propose(hash(0x9999));
    commitV2();
    await w.index();
    expect(await one(VERSION_2)).toMatchObject({
      rules_text: "",
      config_json: { max_per_coin_bps: 2500, max_trades_per_day: 2 },
      hash: V2.slice(2),
    });
  });
});

describe("SeasonLedger corrections", () => {
  const noteHash = keccak256(stringToHex("stop buying gold"));
  const CORRECTIONS = `select bot_id::text as bot, decision_id::text as decision, user_wallet, chip, note,
    encode(note_hash, 'hex') as hash, tx_hash, extract(epoch from created_at)::bigint::text as created
    from corrections order by id`;
  const correct = (chip = 0, tx = w.chain.tx()) => {
    w.chain.emit(tx, "SeasonLedger", "CallCorrected", { botId: 1n, decisionId, noteHash, chip, season: 0 });
    return tx;
  };

  it("CallCorrected writes the correction under the signer", async () => {
    await seedAliceWithDecision();
    const tx = correct();
    await w.index();

    expect(await one(CORRECTIONS)).toEqual({
      bot: "1",
      decision: DECISION,
      user_wallet: ALICE,
      chip: "too risky",
      note: null,
      hash: noteHash.slice(2),
      tx_hash: tx.hash,
      created: timeOf(tx.block).toString(),
    });
  });

  it.each(CHIPS.map((chip, id) => [id, chip] as const))("chip %i is '%s'", async (id, chip) => {
    await seedAliceWithDecision();
    correct(id);
    await w.index();
    expect(await one(CORRECTIONS)).toMatchObject({ chip });
  });

  it("confirms the pending row that holds the note", async () => {
    await seedAliceWithDecision();
    await seedPendingCorrection(w.db, {
      botId: 1n,
      decision: DECISION,
      wallet: ALICE,
      chip: "too risky",
      note: "stop buying gold",
      noteHash,
    });
    const tx = correct();
    await w.index();

    const { rows } = await w.db.query(CORRECTIONS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ note: "stop buying gold", tx_hash: tx.hash });
  });

  it.each([
    ["another note hash", ALICE, hash(1)],
    ["another wallet", BOB, noteHash],
  ])("leaves a pending row with %s alone", async (_what, wallet, pendingHash) => {
    await seedAliceWithDecision();
    await seedPendingCorrection(w.db, {
      botId: 1n,
      decision: DECISION,
      wallet,
      chip: "too risky",
      note: "not this one",
      noteHash: pendingHash,
    });
    const tx = correct();
    await w.index();

    const { rows } = await w.db.query(CORRECTIONS);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ note: "not this one", tx_hash: null });
    expect(rows[1]).toMatchObject({ note: null, tx_hash: tx.hash, user_wallet: ALICE });
  });

  it("keeps identical corrections apart, also inside one tx, and a replay adds none", async () => {
    await seedAliceWithDecision();
    const tx = correct();
    correct(0, tx);
    correct(0, tx);
    const other = correct();
    const indexer = await w.index();
    await indexer.replay(tx.block, other.block);

    const { rows } = await w.db.query<{ tx_hash: string }>(CORRECTIONS);
    expect(rows.map((r) => r.tx_hash)).toEqual([tx.hash, tx.hash, tx.hash, other.hash]);
  });
});

describe("seasons and trust scores", () => {
  it("SeasonOpened and SeasonClosed fill the seeded row and leave the config alone", async () => {
    await seedSeason(w.db, 0);
    w.chain.emit(w.chain.tx(), "SeasonLedger", "SeasonOpened", { n: 0, start: 1_795_000_000n, end: 1_795_200_000n });
    const closed = w.chain.tx();
    w.chain.emit(closed, "SeasonLedger", "SeasonClosed", { n: 0, dataRoot: hash(7), dataURI: "https://x/season-0.jsonl" });
    await w.index();

    expect(
      await one(`select extract(epoch from starts_at)::bigint::text as starts, extract(epoch from ends_at)::bigint::text as ends,
                 status::text as status, kind::text as kind, provisional_min_trades as min, encode(data_root, 'hex') as root,
                 data_uri, root_tx from seasons`),
    ).toEqual({
      starts: "1795000000",
      ends: "1795200000",
      status: "closed",
      kind: "sprint",
      min: 8,
      root: hash(7).slice(2),
      data_uri: "https://x/season-0.jsonl",
      root_tx: closed.hash,
    });
  });

  it("a NUL in dataURI can't make Postgres refuse the close", async () => {
    await seedSeason(w.db, 0);
    w.chain.emit(w.chain.tx(), "SeasonLedger", "SeasonClosed", { n: 0, dataRoot: hash(7), dataURI: "a\u0000b" });
    await w.index();
    expect(await one("select status::text as status, data_uri from seasons")).toEqual({
      status: "closed",
      data_uri: "a�b",
    });
  });

  function commitScores(root: `0x${string}`, sameBlock = false) {
    const tx = w.chain.tx({ sameBlock });
    w.chain.emit(tx, "TrustScoreRegistry", "ScoresCommitted", { season: 0, rulesVersion: RULES, root, uri: "u" });
    w.chain.setRoot(0, root, RULES);
    return tx;
  }
  const SCORES = "select encode(scores_root, 'hex') as root, scores_tx, trust_rules_version as version from seasons";

  it("stores the latest scores root, also after the first is replayed", async () => {
    await seedSeason(w.db, 0);
    const first = commitScores(hash(1));
    const latest = commitScores(hash(2));
    const indexer = await w.index();
    await indexer.replay(first.block, first.block);

    expect(await one(SCORES)).toEqual({
      root: hash(2).slice(2),
      scores_tx: latest.hash,
      version: "trust-v1-sprint",
    });
  });

  it.each([
    ["in a later block", false],
    ["later in the same block", true],
  ])("the same root committed again %s keeps the later tx", async (_where, sameBlock) => {
    await seedSeason(w.db, 0);
    const first = commitScores(hash(1));
    const again = commitScores(hash(1), sameBlock);
    const indexer = await w.index();
    await indexer.replay(first.block, first.block);
    expect(await one(SCORES)).toMatchObject({ scores_tx: again.hash });
  });
});

describe("DailyCall", () => {
  const CALL = `select user_wallet, user_up, bot_up, encode(bot_up_sig, 'hex') as sig, price_at_call_e8::text as price,
    round_at_call::text as round, call_tx, settle_price_e8::text as settle_price, settle_round::text as settle_round,
    user_correct, bot_correct, settle_tx from daily_calls`;

  function called(price = 6_392_295_000_000n) {
    const tx = w.chain.tx();
    w.chain.emit(tx, "DailyCall", "Called", { botId: 1n, day: DAY, userUp: true, botUp: false, price, roundId: 50_887n });
    return tx;
  }
  function settled(price: bigint, userCorrect: boolean, botCorrect: boolean) {
    const tx = w.chain.tx();
    w.chain.emit(tx, "DailyCall", "Settled", { botId: 1n, day: DAY, price, roundId: 50_900n, userCorrect, botCorrect });
    return tx;
  }

  it("fills the user's half of the runner's row, then the settlement", async () => {
    await seedBot(w.db, { id: 1n, owner: ALICE, personaHash: PERSONA });
    await seedBotView(w.db, { botId: 1n, day: DAY, botUp: false, sig: "0xbeef" });
    const call = called();
    const settle = settled(6_400_000_000_000n, true, false);
    await w.index();

    expect(await one(CALL)).toEqual({
      user_wallet: ALICE,
      user_up: true,
      bot_up: false,
      sig: "beef",
      price: "6392295000000",
      round: "50887",
      call_tx: call.hash,
      settle_price: "6400000000000",
      settle_round: "50900",
      user_correct: true,
      bot_correct: false,
      settle_tx: settle.hash,
    });
  });

  it("an equal price is no winner: null, not false", async () => {
    w.createBot();
    called(100n);
    settled(100n, false, false);
    await w.index();
    expect(await one(CALL)).toMatchObject({ user_correct: null, bot_correct: null, settle_price: "100" });
  });

  it("still records a user's call when the runner's row is missing", async () => {
    w.createBot();
    called();
    await w.index();
    expect(await one(CALL)).toMatchObject({ user_wallet: ALICE, user_up: true, sig: "" });
  });

  it("keeps an int256 exact", async () => {
    w.createBot();
    called(2n ** 255n - 1n);
    await w.index();
    expect(await one(CALL)).toMatchObject({ price: (2n ** 255n - 1n).toString() });
  });
});

describe("Challenges", () => {
  const CHALLENGE = `select code, season_id, challenger_bot::text as challenger, opponent_bot::text as opponent,
    create_tx, accept_tx, status::text as status, winner_bot::text as winner from challenges`;

  async function setUp() {
    await seedSeason(w.db, 1);
    w.createBot();
    w.createBot(2n, BOB, BOBS_PERSONA);
    const create = w.chain.tx();
    w.chain.emit(create, "Challenges", "ChallengeCreated", { code: CODE, myBot: 1n, season: 1 });
    return create;
  }

  it("create → accept → settle", async () => {
    const create = await setUp();
    const accept = w.chain.tx();
    w.chain.emit(accept, "Challenges", "ChallengeAccepted", { code: CODE, theirBot: 2n });
    w.chain.emit(w.chain.tx(), "Challenges", "ChallengeSettled", { code: CODE, winnerBot: 2n });
    await w.index();

    expect(await one(CHALLENGE)).toEqual({
      code: CODE,
      season_id: 1,
      challenger: "1",
      opponent: "2",
      create_tx: create.hash,
      accept_tx: accept.hash,
      status: "settled",
      winner: "2",
    });
  });

  it("create → expire", async () => {
    await setUp();
    w.chain.emit(w.chain.tx(), "Challenges", "ChallengeExpired", { code: CODE });
    await w.index();
    expect(await one(CHALLENGE)).toMatchObject({ status: "expired", opponent: null, winner: null });
  });

  it("the full code resolves from a short link", async () => {
    await setUp();
    await w.index();
    expect(await one(`select code from site_challenge_by_short_code('${CODE.slice(2, 18)}')`)).toEqual({ code: CODE });
  });
});

describe("BotForwarder", () => {
  it.each(["submitted", "rejected"])("leaves a %s relay_log row to the relayer", async (status) => {
    const tx = w.chain.tx();
    w.chain.emit(tx, "BotForwarder", "ExecutedForwardRequest", { signer: ALICE, nonce: 0n, success: true });
    await seedRelay(w.db, { wallet: ALICE, txHash: tx.hash, status });
    await w.index();
    expect(await one("select status::text as status, gas_used from relay_log")).toEqual({ status, gas_used: null });
  });

  it("can't be used to pad /stats: a forward nobody relayed adds no row", async () => {
    w.chain.emit(w.chain.tx(), "BotForwarder", "ExecutedForwardRequest", { signer: BOB, nonce: 0n, success: true });
    await w.index();
    expect(await one("select count(*)::int as n from relay_log")).toEqual({ n: 0 });
    expect(await one("select unique_signers::int as n from site_activity_stats")).toEqual({ n: 0 });
  });
});

it("RulesPublished has no table and is not a problem", async () => {
  w.chain.emit(w.chain.tx(), "TrustScoreRegistry", "RulesPublished", { version: RULES, uri: "u", docHash: zeroHash });
  await w.index();
  expect(w.log.problems()).toEqual([]);
});
