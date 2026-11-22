import { keccak256, parseEventLogs, stringToHex, type Hex } from "viem";
import {
  approvedOrderTypedData,
  dailyCallBotViewTypedData,
  decisionIdFromUuid,
  istDay,
} from "@botfolio/shared";
import { CONTRACT_EVENTS } from "../../../src/indexer/abi";
import type { Queryable } from "../../../src/indexer/db";
import { ACCOUNTS, type Fork } from "./fork";
import { seedBigMove, seedBotView, seedDecision, seedPendingCorrection, seedSeason } from "./seed";

const { admin, runner, committer, alice, bob, carol } = ACCOUNTS;

export const IDS = {
  aliceBot: 1n,
  bobBot: 2n,
  carolBot: 3n,
  houseBot: 4n,
  aliceDecision: "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab",
  bobDecision: "00000000-0000-4000-8000-000000000b0b",
  unknownDecision: "11111111-2222-4333-8444-555555555555",
};

export const VALUES = {
  alicePersona: keccak256(stringToHex("careful, loves gold")),
  bobPersona: keccak256(stringToHex("yolo bitcoin")),
  carolPersona: keccak256(stringToHex("buys dips")),
  housePersona: keccak256(stringToHex("steady sam")),
  v2Hash: keccak256(stringToHex("alice v2")),
  note: "stop buying gold",
  noteHash: keccak256(stringToHex("stop buying gold")),
  dataRoot: keccak256(stringToHex("season-0 root")),
  firstRoot: keccak256(stringToHex("scores, first")),
  finalRoot: keccak256(stringToHex("scores, final")),
  rules: stringToHex("trust-v1-sprint", { size: 32 }),
  dataUri: "https://example.invalid/season-0.jsonl",
};

const IST_NOON = 12n * 3600n;
const IST_SETTLE = 21n * 3600n + 5n;
const timeAt = (day: number, seconds: bigint) => BigInt(day) * 86_400n + seconds - 19_800n;

export interface Opened {
  day: number;
  botUpSig: Hex;
}

/** Part 1, what exists before any decision: seasons, the bots, the runner's view for today's Daily Call. */
export async function openAndCreateBots(fork: Fork): Promise<Opened> {
  const now = await fork.client.getBlock({ blockTag: "latest" });
  // Noon IST tomorrow, so Daily Call is open whatever time the test runs.
  const day = istDay(Number(now.timestamp)) + 1;
  await fork.setClock(timeAt(day, IST_NOON));

  const start = timeAt(day, 0n);
  await fork.send(committer, "SeasonLedger", "openSeason", [0, start, start + 2n * 86_400n]);
  await fork.send(admin, "TrustScoreRegistry", "publishRules", [VALUES.rules, "https://example.invalid/rules", VALUES.dataRoot]);

  await fork.relay(alice, "BotRegistry", "createBot", [VALUES.alicePersona, 4000, 4]);
  await fork.relay(bob, "BotRegistry", "createBot", [VALUES.bobPersona, 5000, 8]);
  // Nothing stops a user calling the contracts directly.
  await fork.send(carol, "BotRegistry", "createBot", [VALUES.carolPersona, 1000, 1]);
  await fork.send(admin, "BotRegistry", "createHouseBot", [VALUES.housePersona, 2000, 8]);

  const botUpSig = await runner.signTypedData(
    dailyCallBotViewTypedData(fork.addresses.DailyCall, { botId: IDS.aliceBot, day, botUp: false }),
  );
  return { day, botUpSig };
}

/** The off-chain rows the runner and the app write between the two parts. */
export async function seedOffChain(db: Queryable, { day, botUpSig }: Opened): Promise<void> {
  await seedDecision(db, IDS.aliceDecision, IDS.aliceBot);
  await seedDecision(db, IDS.bobDecision, IDS.bobBot);
  await seedBigMove(db, { decision: IDS.aliceDecision, actionIndex: 1, botId: IDS.aliceBot });
  await seedBotView(db, { botId: IDS.aliceBot, day, botUp: false, sig: botUpSig });
  await seedPendingCorrection(db, {
    botId: IDS.aliceBot,
    decision: IDS.aliceDecision,
    wallet: alice.address,
    chip: "too risky",
    note: VALUES.note,
    noteHash: VALUES.noteHash,
  });
}

export async function seedSeasons(db: Queryable): Promise<void> {
  await seedSeason(db, 0);
  await seedSeason(db, 1);
}

export interface Played {
  approveTx: Hex;
  correctionTx: Hex;
  callTx: Hex;
  settleTx: Hex;
  closeTx: Hex;
  scoresTx: Hex;
  acceptedCode: Hex;
  expiredCode: Hex;
}

/** Part 2: every kind of user and system event, through the contracts' real rules. */
export async function play(fork: Fork, { day, botUpSig }: Opened): Promise<Played> {
  const { addresses, relay, send } = fork;
  const aliceId = decisionIdFromUuid(IDS.aliceDecision);
  const bobId = decisionIdFromUuid(IDS.bobDecision);
  const order = (botId: bigint, asset: number, bps: number, decisionId: Hex, actionIndex = 0, buy = true) => ({
    botId,
    asset,
    buy,
    bps,
    decisionId,
    actionIndex,
  });

  // The third order repeats the first, so the contract emits OrderSkipped(USED).
  await send(runner, "PaperLedger", "executeBatch", [
    [order(IDS.aliceBot, 0, 1000, aliceId), order(IDS.bobBot, 1, 2000, bobId), order(IDS.aliceBot, 0, 1000, aliceId)],
  ]);
  await send(runner, "PaperLedger", "executeBatch", [[order(IDS.bobBot, 1, 5000, bobId, 1, false)]]);

  const latest = await fork.client.getBlock({ blockTag: "latest" });
  const bigMove = { ...order(IDS.aliceBot, 4, 3500, aliceId, 1), deadline: latest.timestamp + 7200n };
  const runnerSig = await runner.signTypedData(approvedOrderTypedData(addresses.PaperLedger, bigMove));
  const approve = await relay(alice, "PaperLedger", "executeApproved", [bigMove, runnerSig]);

  const call = await relay(alice, "DailyCall", "call", [IDS.aliceBot, true, false, botUpSig]);

  const correct = await relay(alice, "SeasonLedger", "recordCorrection", [IDS.aliceBot, aliceId, VALUES.noteHash, 0]);
  // Three hostile ones: another bot's decision, no such decision, and a chip that doesn't exist.
  await relay(alice, "SeasonLedger", "recordCorrection", [IDS.aliceBot, bobId, VALUES.noteHash, 1]);
  await send(carol, "SeasonLedger", "recordCorrection", [
    IDS.carolBot,
    decisionIdFromUuid(IDS.unknownDecision),
    VALUES.noteHash,
    2,
  ]);
  await send(bob, "SeasonLedger", "recordCorrection", [IDS.bobBot, bobId, VALUES.noteHash, 255]);

  await relay(alice, "SeasonLedger", "commitVersion", [IDS.aliceBot, 2, VALUES.v2Hash, 2500, 2]);
  await relay(bob, "BotRegistry", "setActive", [IDS.bobBot, false]);
  await send(admin, "BotRegistry", "setActive", [IDS.carolBot, false]);

  const codeOf = (logs: Awaited<ReturnType<typeof send>>["logs"]) =>
    parseEventLogs({ abi: CONTRACT_EVENTS.Challenges, eventName: "ChallengeCreated", logs })[0]!.args.code;
  const acceptedCode = codeOf((await relay(alice, "Challenges", "create", [IDS.aliceBot, 0])).logs);
  const expiredCode = codeOf((await relay(bob, "Challenges", "create", [IDS.bobBot, 0])).logs);
  await relay(bob, "Challenges", "accept", [acceptedCode, IDS.bobBot]);

  // 21:00 IST the same day, with BTC 1 % higher: the user (up) is right and the bot (down) is wrong.
  await fork.setClock(timeAt(day, IST_SETTLE), { btcBps: 100n });
  const settle = await send(committer, "DailyCall", "settle", [[IDS.aliceBot, IDS.bobBot], day]);

  await send(committer, "TrustScoreRegistry", "commitScores", [0, VALUES.rules, VALUES.firstRoot, "scores-1"]);
  const scores = await send(committer, "TrustScoreRegistry", "commitScores", [0, VALUES.rules, VALUES.finalRoot, "scores-2"]);
  const close = await send(committer, "SeasonLedger", "closeSeason", [0, VALUES.dataRoot, VALUES.dataUri]);
  await send(committer, "Challenges", "settle", [acceptedCode, IDS.bobBot]);
  await send(carol, "Challenges", "expire", [expiredCode]);

  return {
    approveTx: approve.transactionHash,
    correctionTx: correct.transactionHash,
    callTx: call.transactionHash,
    settleTx: settle.transactionHash,
    closeTx: close.transactionHash,
    scoresTx: scores.transactionHash,
    acceptedCode,
    expiredCode,
  };
}
