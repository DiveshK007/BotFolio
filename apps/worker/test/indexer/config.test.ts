import { describe, expect, it, vi } from "vitest";
import { zeroAddress } from "viem";
import { startIndexer } from "../../src/indexer";
import { ADDRESS_ENV, loadIndexerConfig } from "../../src/indexer/config";
import { CONTRACT_NAMES } from "../../src/indexer/abi";
import { ADDRESSES } from "./helpers/fake-chain";
import { memoryLog } from "./helpers/world";

const PASSWORD = "hunter2-not-for-logs";
const ENV: Record<string, string> = {
  ...Object.fromEntries(CONTRACT_NAMES.map((name) => [ADDRESS_ENV[name], ADDRESSES[name]])),
  DATABASE_URL: `postgres://indexer:${PASSWORD}@localhost:5432/botfolio`,
  INDEXER_START_BLOCK: "12091011",
};

describe("loadIndexerConfig", () => {
  it("reads all seven addresses, the database and the start block", () => {
    expect(loadIndexerConfig(ENV)).toEqual({
      ok: true,
      config: { database: { connectionString: ENV.DATABASE_URL }, addresses: ADDRESSES, startBlock: 12_091_011n },
    });
  });

  it("lowercases a checksummed address", () => {
    const loaded = loadIndexerConfig({ ...ENV, FORWARDER_ADDRESS: "0x9E596d809a20A272c788726f592c0d1629755440" });
    expect(loaded.ok && loaded.config.addresses.BotForwarder).toBe("0x9e596d809a20a272c788726f592c0d1629755440");
  });

  it.each(Object.keys(ENV))("names %s when it is missing", (name) => {
    const loaded = loadIndexerConfig({ ...ENV, [name]: "" });
    expect(loaded.ok).toBe(false);
    expect(!loaded.ok && loaded.problems.join()).toContain(name);
  });

  it.each([
    ["DAILY_CALL_ADDRESS", "0x1234"],
    ["DAILY_CALL_ADDRESS", zeroAddress],
    ["DAILY_CALL_ADDRESS", ADDRESSES.BotRegistry],
    ["INDEXER_START_BLOCK", "latest"],
    ["INDEXER_START_BLOCK", "-1"],
    ["DATABASE_URL", "localhost"],
  ])("refuses %s=%s", (name, value) => {
    expect(loadIndexerConfig({ ...ENV, [name]: value }).ok).toBe(false);
  });
});

describe("DATABASE_URL: no password in plain text to another machine", () => {
  const load = (url: string) => loadIndexerConfig({ ...ENV, DATABASE_URL: url });

  it("turns on verified TLS when a remote URL names no sslmode", () => {
    const loaded = load("postgres://u:p@db.example.com:5432/postgres");
    expect(loaded.ok && loaded.config.database.ssl).toBe(true);
  });

  it.each(["require", "verify-ca", "verify-full"])("takes sslmode=%s as written", (mode) => {
    const loaded = load(`postgres://u:p@db.example.com/postgres?sslmode=${mode}`);
    expect(loaded.ok).toBe(true);
    expect(loaded.ok && loaded.config.database.ssl).toBeUndefined();
  });

  it.each([
    "postgres://u:p@db.example.com/postgres?sslmode=disable",
    "postgres://u:p@db.example.com/postgres?sslmode=prefer",
    "postgres://u:p@db.example.com/postgres?ssl=false",
    "postgres://u:p@localhost/postgres?host=db.example.com",
  ])("refuses %s", (url) => {
    expect(load(url).ok).toBe(false);
  });
});

describe("startIndexer", () => {
  it("doesn't start without config, opens no database, and says what's missing", () => {
    const log = memoryLog();
    const openDb = vi.fn();
    expect(startIndexer({ rpcUrls: ["http://127.0.0.1:1"], env: {}, log, openDb })).toBeNull();
    expect(openDb).not.toHaveBeenCalled();
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]!.message).toBe("NOT started");
    for (const name of [...Object.values(ADDRESS_ENV), "DATABASE_URL", "INDEXER_START_BLOCK"]) {
      expect(JSON.stringify(log.lines[0]!.fields)).toContain(name);
    }
  });

  it("never logs DATABASE_URL", () => {
    const log = memoryLog();
    startIndexer({ rpcUrls: ["http://127.0.0.1:1"], env: { ...ENV, CHALLENGES_ADDRESS: "" }, log, openDb: vi.fn() });
    expect(JSON.stringify(log.lines)).not.toContain(PASSWORD);
  });
});
