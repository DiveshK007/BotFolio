import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { databaseConfig, openDb } from "../../src/relay/db";
import { PgRelayGuard } from "../../src/relay/guard";
import { REGISTRY } from "./helpers/fakes";

const url = process.env.RELAY_TEST_DATABASE_URL;

/**
 * PGlite runs one transaction at a time, so it can't show the advisory lock working across connections.
 * Point RELAY_TEST_DATABASE_URL at a THROWAWAY local Postgres with schema.sql applied to run this.
 */
describe.skipIf(!url)("limits on a real Postgres, many connections (#39)", () => {
  it("never lets parallel reservations past either limit", async () => {
    if (!/^postgres(ql)?:\/\/[^/]*(127\.0\.0\.1|localhost)[:/]/.test(url!)) throw new Error("local databases only");
    const db = openDb(databaseConfig(url)!, () => {});
    try {
      await db.query("truncate relay_log");
      const guards = [1, 2].map(
        () => new PgRelayGuard(db, { perWalletPerDay: 30, perHourGlobal: 20, newBotsPerIpPerDay: 100 }),
      );
      const wallet = (i: number) => `0x${(i + 1).toString(16).padStart(40, "0")}` as Address;
      const attempt = (i: number) => ({ wallet: wallet(i), target: REGISTRY, selector: null, action: null, ip: `ip${i}` });

      const same = await Promise.allSettled(Array.from({ length: 16 }, (_, i) => guards[i % 2]!.reserve(attempt(0))));
      expect(same.filter((r) => r.status === "fulfilled")).toHaveLength(1);

      const many = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => guards[i % 2]!.reserve(attempt(i + 1))));
      expect(many.filter((r) => r.status === "fulfilled")).toHaveLength(19);
    } finally {
      await db.close();
    }
  }, 30_000);
});
