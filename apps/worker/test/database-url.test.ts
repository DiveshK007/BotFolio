import pg from "pg";
import { describe, expect, it } from "vitest";
import { CONTRACT_NAMES } from "../src/indexer/abi";
import { ADDRESS_ENV, loadIndexerConfig } from "../src/indexer/config";
import { databaseConfig as relayConfig } from "../src/relay/db";
import { databaseConfig as schedulerConfig } from "../src/scheduler/db";

// All three read the same DATABASE_URL, so all three must agree on what is safe.
const READERS: Record<string, (url: string) => pg.ClientConfig | null> = {
  relayer: (url) => relayConfig(url),
  scheduler: (url) => {
    const config = schedulerConfig(url);
    return typeof config === "string" ? null : config;
  },
  indexer: (url) => {
    const addresses = CONTRACT_NAMES.map((name, i) => [ADDRESS_ENV[name], `0x${String(i + 1).padStart(40, "0")}`]);
    const loaded = loadIndexerConfig({ ...Object.fromEntries(addresses), INDEXER_START_BLOCK: "1", DATABASE_URL: url });
    return loaded.ok ? loaded.config.database : null;
  },
};

const REMOTE = "postgres://u:p@db.example.com/x";
const UNSAFE = [
  `${REMOTE}?sslmode=disable`,
  `${REMOTE}?sslmode=no-verify`,
  `${REMOTE}?ssl=false`,
  `${REMOTE}?sslmode=require&sslmode=disable`, // pg takes the last value
  `${REMOTE}?sslmode=require&uselibpqcompat=true`, // pg then stops checking the certificate
  "postgres://u:p@localhost/x?host=db.example.com",
  "postgres://u:replace-me@db.example.com/x",
];
const SAFE = [REMOTE, `${REMOTE}?sslmode=require`, `${REMOTE}?sslmode=verify-ca`, `${REMOTE}?sslmode=verify-full`];

describe.each(Object.entries(READERS))("DATABASE_URL in the %s", (_name, read) => {
  it.each(UNSAFE)("refuses %s", (url) => {
    expect(read(url)).toBeNull();
  });

  // Asks pg itself what it would do, instead of trusting our reading of the URL.
  it.each(SAFE)("takes %s, and pg really verifies TLS with it", (url) => {
    const config = read(url);
    expect(config).not.toBeNull();
    const { ssl } = new pg.Client(config!) as unknown as { ssl: boolean | { rejectUnauthorized?: boolean } };
    expect(ssl).toBeTruthy();
    if (typeof ssl === "object") expect(ssl.rejectUnauthorized).not.toBe(false);
  });
});
