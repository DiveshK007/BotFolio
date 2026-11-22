import { afterAll, beforeAll, beforeEach } from "vitest";
import { padHex, stringToHex, type Address } from "viem";
import { decisionIdFromUuid } from "@botfolio/shared";
import type { ChainSource } from "../../../src/indexer/chain";
import { Indexer, type IndexerDeps } from "../../../src/indexer/indexer";
import type { Log } from "../../../src/indexer/log";
import type { Problem } from "../../../src/indexer/apply";
import { createTestDb, type TestDb } from "./db";
import { ADDRESSES, FakeChain, START, type Tx } from "./fake-chain";
import { hash } from "./seed";

export const ALICE: Address = padHex("0xa11ce", { size: 20 });
export const BOB: Address = padHex("0xb0b", { size: 20 });
export const RELAYER: Address = padHex("0x4e1a", { size: 20 });
export const DECISION = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
export const BOBS_DECISION = "00000000-0000-4000-8000-000000000b0b";
export const PERSONA = hash(0xaaaa);
export const BOBS_PERSONA = hash(0xbbbb);
export const CODE = hash(0xc0de);
export const RULES = stringToHex("trust-v1-sprint", { size: 32 });
export const DAY = 20_780;
export const UINT256_MAX = 2n ** 256n - 1n;
export const UINT80_MAX = 2n ** 80n - 1n;

export function memoryLog(): Log & { lines: { message: string; fields?: object }[]; problems(): Problem[] } {
  const lines: { message: string; fields?: object }[] = [];
  return {
    lines,
    info: (message, fields) => void lines.push({ message, fields }),
    warn: (message, fields) => void lines.push({ message, fields }),
    problems: () => lines.filter((l) => l.message.startsWith("event ")).map((l) => l.fields as Problem),
  };
}

export interface World {
  db: TestDb;
  chain: FakeChain;
  log: ReturnType<typeof memoryLog>;
  indexer(options?: Partial<IndexerDeps> & { sources?: ChainSource[] }): Indexer;
  /** A new indexer, run until it has nothing left to do. */
  index(options?: Partial<IndexerDeps>): Promise<Indexer>;
  createBot(id?: bigint, owner?: Address, personaHash?: `0x${string}`): Tx;
}

/** A fresh chain and empty tables for each test. */
export function useWorld(): World {
  const world = {} as World;

  beforeAll(async () => {
    world.db = await createTestDb();
  }, 60_000);
  afterAll(async () => {
    await world.db.close();
  });

  beforeEach(async () => {
    await world.db.reset();
    world.chain = new FakeChain();
    world.log = memoryLog();
  });

  world.indexer = (options = {}) =>
    new Indexer({
      db: world.db,
      sources: [world.chain.as()],
      addresses: ADDRESSES,
      startBlock: START,
      log: world.log,
      ...options,
    });

  world.index = async (options = {}) => {
    const indexer = world.indexer(options);
    await drain(indexer);
    return indexer;
  };

  world.createBot = (id = 1n, owner = ALICE, personaHash = PERSONA) => {
    const tx = world.chain.tx();
    world.chain.emit(tx, "BotRegistry", "BotCreated", {
      botId: id,
      owner,
      personaHash,
      maxPerCoinBps: 4000,
      maxTradesPerDay: 4,
    });
    world.chain.setBot(id, { active: true });
    return tx;
  };

  return world;
}

export async function drain(indexer: Indexer): Promise<void> {
  for (let i = 0; i < 1000; i++) {
    const result = await indexer.tick();
    if (result.status !== "written" || result.to >= result.head) return;
  }
  throw new Error("the indexer never caught up");
}

export function trade(over: Partial<Record<"cashE8" | "unitsE18" | "priceE8" | "roundId" | "botId", bigint>> = {}) {
  return {
    botId: 1n,
    asset: 4,
    buy: true,
    cashE8: 25_000_00000000n,
    unitsE18: 6_700000000000000000n,
    priceE8: 3_730_84000000n,
    roundId: 14_811n,
    updatedAt: 1_790_000_000n,
    decisionId: decisionIdFromUuid(DECISION),
    actionIndex: 0,
    ...over,
  };
}
