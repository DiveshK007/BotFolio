import type { AddressInfo } from "node:net";
import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { HealthState } from "../src/health";
import { classifyRound, readFeed, type OracleReading } from "../src/oracle";
import { createWorkerServer } from "../src/server";

const NOW = 1_800_000_000;

function reading(asset: OracleReading["asset"], fresh: boolean): OracleReading {
  return {
    asset,
    feed: "0x0000000000000000000000000000000000000001",
    roundId: "1",
    priceE8: "6392295000000",
    updatedAt: NOW - 60,
    ageSeconds: 60,
    maxAgeSeconds: 1800,
    valid: true,
    fresh,
  };
}

describe("classifyRound (SPEC §5 rule 3)", () => {
  const base = { roundId: 10n, answer: 100n, updatedAt: BigInt(NOW - 100), answeredInRound: 10n };

  it("is fresh inside max age", () => {
    expect(classifyRound(base, NOW, 1800)).toMatchObject({ valid: true, fresh: true, ageSeconds: 100 });
  });
  it("is stale past max age", () => {
    expect(classifyRound({ ...base, updatedAt: BigInt(NOW - 1801) }, NOW, 1800).fresh).toBe(false);
  });
  it("rejects a non-positive answer or zero updatedAt", () => {
    expect(classifyRound({ ...base, answer: 0n }, NOW, 1800).valid).toBe(false);
    expect(classifyRound({ ...base, updatedAt: 0n }, NOW, 1800).valid).toBe(false);
  });
  it("rejects a future updatedAt and an answer above uint64, like OracleReader", () => {
    expect(classifyRound({ ...base, updatedAt: BigInt(NOW + 1) }, NOW, 1800).fresh).toBe(false);
    expect(classifyRound({ ...base, answer: 2n ** 64n }, NOW, 1800).valid).toBe(false);
    expect(classifyRound({ ...base, updatedAt: BigInt(NOW) }, NOW, 1800).fresh).toBe(true);
  });
  it("rejects answeredInRound < roundId but ignores answeredInRound = 0", () => {
    expect(classifyRound({ ...base, answeredInRound: 9n }, NOW, 1800).valid).toBe(false);
    expect(classifyRound({ ...base, answeredInRound: 0n }, NOW, 1800).valid).toBe(true);
  });

  // The contracts trade at age == maxAge and skip one second later (OracleReader.isFresh). Off-chain must agree (#151).
  it.each([
    ["crypto", 1800],
    ["gold", 21_600],
  ])("%s: fresh at exactly max age, stale one second later", (_name, maxAge) => {
    expect(classifyRound({ ...base, updatedAt: BigInt(NOW - maxAge) }, NOW, maxAge).fresh).toBe(true);
    expect(classifyRound({ ...base, updatedAt: BigInt(NOW - maxAge - 1) }, NOW, maxAge)).toMatchObject({
      valid: true,
      fresh: false,
    });
  });
});

describe("readFeed", () => {
  const feed = { asset: "GOLD", address: "0x9aD0199a67588ee293187d26bA1BE61cb07A214c", maxAgeSeconds: 21_600 } as const;
  const client = (readContract: () => Promise<unknown>) => ({ readContract }) as unknown as PublicClient;

  it("reads a 3 h old gold round as fresh, with its age", async () => {
    const round = [7n, 265_000_000_000n, 0n, BigInt(NOW - 3 * 3600), 7n];
    expect(await readFeed(client(async () => round), feed, NOW)).toMatchObject({
      roundId: "7",
      ageSeconds: 3 * 3600,
      valid: true,
      fresh: true,
    });
  });

  it("an unreadable feed is stale, not a throw, so the slot holds that asset instead of failing", async () => {
    const r = await readFeed(client(async () => Promise.reject(new Error("rpc down\nat line 2"))), feed, NOW);
    expect(r).toMatchObject({ asset: "GOLD", valid: false, fresh: false, error: "rpc down" });
  });
});

describe("HealthState", () => {
  it("is degraded until the oracle has been checked", () => {
    const h = new HealthState({ provider: "fake", capUsd: null });
    expect(h.snapshot().status).toBe("degraded");
    expect(h.snapshot().reasons).toContain("oracle not checked yet");
  });

  it("reports stale feeds, last slot run and LLM budget", () => {
    const h = new HealthState({ provider: "xai", capUsd: 1 });
    const at = new Date("2026-11-23T07:30:00Z");
    h.recordOracle([reading("BTC", true), reading("GOLD", false)], at);
    h.recordSlotRun({ slotId: "s1", kind: "scheduled", slotTime: at.toISOString(), finishedAt: at.toISOString() });
    // 640k input tokens at $1.25/M = $0.80 → 80 % of a $1 cap → alert.
    h.recordLlmUsage("grok-4.20-0309-non-reasoning", { inTok: 640_000, outTok: 0 }, at);

    const s = h.snapshot(at);
    expect(s.status).toBe("degraded");
    expect(s.reasons).toEqual(["GOLD price too old", "LLM budget above 80 %"]);
    expect(s.lastSlotRun?.slotId).toBe("s1");
    expect(s.llm).toMatchObject({ month: "2026-11", spentUsd: 0.8, capUsd: 1, budget: "alert" });
  });

  it("resets spend at the start of a new month", () => {
    const h = new HealthState({ provider: "xai", capUsd: 1 });
    h.recordLlmUsage("grok-4.20-0309-non-reasoning", { inTok: 1_000_000, outTok: 0 }, new Date("2026-11-30T12:00:00Z"));
    expect(h.budget(new Date("2026-11-30T12:00:00Z"))).toBe("resting");
    expect(h.budget(new Date("2026-12-01T00:00:00Z"))).toBe("ok");
  });
});

describe("GET /healthz", () => {
  it("returns 200 with the health snapshot, 404 elsewhere", async () => {
    const h = new HealthState({ provider: "fake", capUsd: null });
    h.recordOracle([reading("BTC", true)], new Date());
    const server = createWorkerServer({ health: h });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const res = await fetch(`${base}/healthz`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.oracle.feeds[0].asset).toBe("BTC");
      expect(body.llm.budget).toBe("uncapped");
      expect((await fetch(`${base}/nope`)).status).toBe(404);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
