import pg from "pg";
import { describe, expect, it } from "vitest";
import { POOL_MAX, SESSION_POOLER_LIMIT } from "../src/database-url";
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

  // Supabase's certificates chain to its own root, which Node doesn't trust: without the CA every query fails
  // with SELF_SIGNED_CERT_IN_CHAIN (seen on the first Render deploy, Nov 26 2026).
  it.each([
    "postgresql://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
    "postgresql://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require",
    "postgresql://postgres:pw@db.abc.supabase.co:5432/postgres",
  ])("verifies %s against the Supabase root CA", (url) => {
    const config = read(url);
    expect(config).not.toBeNull();
    const { ssl } = new pg.Client(config!) as unknown as { ssl: { ca?: string; rejectUnauthorized?: boolean } };
    expect(ssl.ca).toContain("BEGIN CERTIFICATE");
    expect(ssl.rejectUnauthorized).not.toBe(false);
  });

  it("refuses an unencrypted Supabase URL", () => {
    expect(read("postgresql://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=disable")).toBeNull();
  });
});

// #351: all the worker's pools at once must fit the session pooler.
describe("pool caps", () => {
  it("add up to the session pooler's client limit or less", () => {
    const maxes = Object.values(POOL_MAX);
    expect(maxes.reduce((sum, max) => sum + max, 0)).toBeLessThanOrEqual(SESSION_POOLER_LIMIT);
    expect(maxes.every((max) => max >= 1)).toBe(true);
  });
});
