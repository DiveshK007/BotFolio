import { decisionIdFromUuid } from "@botfolio/shared";
import type { Queryable } from "../../../src/indexer/db";
import type { FakeChain } from "./fake-chain";
import { hash, seedBigMove, seedBot, seedBotView, seedDecision, seedPendingCorrection, seedRelay, seedSeason } from "./seed";
import { ALICE, BOB, BOBS_PERSONA, CODE, DAY, DECISION, PERSONA, RULES, trade } from "./world";

const decisionId = decisionIdFromUuid(DECISION);

/**
 * Two bots' whole history: every event type, and every column where a later event overrides an earlier one
 * (status, scores root, challenge status, season status). Returns the seed for a database that will index it.
 */
export function buildHistory(chain: FakeChain): (db: Queryable) => Promise<void> {
  const next = () => chain.tx();

  const opened = next();
  chain.emit(opened, "SeasonLedger", "SeasonOpened", { n: 0, start: 1_795_000_000n, end: 1_795_200_000n });

  const created = next();
  chain.emit(created, "BotRegistry", "BotCreated", {
    botId: 1n,
    owner: ALICE,
    personaHash: PERSONA,
    maxPerCoinBps: 4000,
    maxTradesPerDay: 4,
  });
  chain.emit(created, "BotForwarder", "ExecutedForwardRequest", { signer: ALICE, nonce: 0n, success: true });
  chain.setBot(1n, { active: true }, created.block);

  chain.emit(next(), "BotRegistry", "BotCreated", {
    botId: 2n,
    owner: BOB,
    personaHash: BOBS_PERSONA,
    maxPerCoinBps: 5000,
    maxTradesPerDay: 8,
  });

  const paused = next();
  chain.emit(paused, "BotRegistry", "BotActiveChanged", { botId: 1n, active: false });
  chain.setBot(1n, { active: false }, paused.block);

  const resumed = next();
  chain.emit(resumed, "BotRegistry", "BotActiveChanged", { botId: 1n, active: true });
  chain.setBot(1n, { active: true }, resumed.block);

  chain.emit(next(), "PaperLedger", "Trade", trade());

  const approved = next();
  chain.emit(approved, "PaperLedger", "Trade", { ...trade(), actionIndex: 1, asset: 0 });
  chain.emit(approved, "PaperLedger", "ApprovedTrade", { botId: 1n, decisionId, actionIndex: 1, owner: ALICE });

  chain.emit(next(), "PaperLedger", "OrderSkipped", { botId: 1n, asset: 4, decisionId, actionIndex: 0, reason: 4 });

  const corrected = next();
  for (const [chip, noteHash] of [[0, hash(1)], [0, hash(1)], [2, hash(2)]] as const) {
    chain.emit(corrected, "SeasonLedger", "CallCorrected", { botId: 1n, decisionId, noteHash, chip, season: 0 });
  }
  chain.emit(corrected, "SeasonLedger", "CallCorrected", { botId: 1n, decisionId: hash(9), noteHash: hash(3), chip: 1, season: 0 });

  const v2 = next();
  chain.emit(v2, "SeasonLedger", "VersionCommitted", { botId: 1n, version: 2, hash: hash(0x22), season: 0 });
  chain.emit(v2, "BotRegistry", "BotLimitsChanged", { botId: 1n, version: 2, maxPerCoinBps: 2500, maxTradesPerDay: 2 });

  chain.emit(next(), "DailyCall", "Called", { botId: 1n, day: DAY, userUp: true, botUp: false, price: 500n, roundId: 7n });

  chain.emit(next(), "Challenges", "ChallengeCreated", { code: CODE, myBot: 1n, season: 0 });
  chain.emit(next(), "Challenges", "ChallengeCreated", { code: hash(0xdead), myBot: 2n, season: 0 });
  chain.emit(next(), "Challenges", "ChallengeAccepted", { code: CODE, theirBot: 2n });

  chain.emit(next(), "TrustScoreRegistry", "RulesPublished", { version: RULES, uri: "rules", docHash: hash(4) });
  for (const root of [hash(0x51), hash(0x52), hash(0x52)]) {
    const scores = next();
    chain.emit(scores, "TrustScoreRegistry", "ScoresCommitted", { season: 0, rulesVersion: RULES, root, uri: "scores" });
    chain.setRoot(0, root, RULES, scores.block);
  }

  chain.emit(next(), "DailyCall", "Settled", {
    botId: 1n,
    day: DAY,
    price: 600n,
    roundId: 8n,
    userCorrect: true,
    botCorrect: false,
  });

  chain.emit(next(), "SeasonLedger", "SeasonClosed", { n: 0, dataRoot: hash(0xda7a), dataURI: "season-0.jsonl" });
  chain.emit(next(), "Challenges", "ChallengeSettled", { code: CODE, winnerBot: 2n });
  chain.emit(next(), "Challenges", "ChallengeExpired", { code: hash(0xdead) });

  const banned = next();
  chain.emit(banned, "BotRegistry", "BotActiveChanged", { botId: 2n, active: false });
  chain.setBot(2n, { active: false, banned: true }, banned.block);

  return async (db) => {
    await seedSeason(db, 0);
    await seedBot(db, { id: 1n, owner: ALICE, personaHash: PERSONA });
    await seedDecision(db, DECISION, 1n);
    await seedBigMove(db, { decision: DECISION, actionIndex: 1, botId: 1n });
    await seedBotView(db, { botId: 1n, day: DAY, botUp: false });
    await seedRelay(db, { wallet: ALICE, txHash: created.hash });
    await seedPendingCorrection(db, {
      botId: 1n,
      decision: DECISION,
      wallet: ALICE,
      chip: "too risky",
      note: "less gold",
      noteHash: hash(1),
    });
  };
}
