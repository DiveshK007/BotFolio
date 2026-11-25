import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { HealthState } from "../../src/health";
import type { OracleReading } from "../../src/oracle";
import { createWorkerServer } from "../../src/server";
import { STATUS_PER_IP_PER_MINUTE, publicStatus, statusRoutes } from "../../src/status/route";

const AT = new Date("2026-11-25T07:30:00Z");

function reading(asset: OracleReading["asset"], fresh: boolean, error?: string): OracleReading {
  return { asset, feed: `0x${"1".repeat(40)}`, roundId: "1", priceE8: "1", updatedAt: 0, ageSeconds: 0, maxAgeSeconds: 1800, valid: !error, fresh, error };
}

function degraded(): HealthState {
  const h = new HealthState({ provider: "xai", capUsd: 1 });
  h.recordOracle([reading("BTC", true), reading("SOL", false, "rpc timeout at rpc1"), reading("GOLD", false)], AT);
  h.recordLlmUsage("grok-4.20-0309-non-reasoning", { inTok: 1_000_000, outTok: 0 }, AT); // $1.25 > $1 cap
  h.addStartProblem("relay disabled: RELAYER_PRIVATE_KEY missing");
  h.recordJobRun("runner", { at: AT.toISOString(), problem: "failed" });
  return h;
}

describe("publicStatus", () => {
  it("lists stale and unreadable feeds and says when bots are resting", () => {
    expect(publicStatus(degraded(), AT)).toEqual({ ok: true, staleFeeds: ["SOL", "GOLD"], resting: true });
  });

  it("is all clear before the first oracle check and under budget", () => {
    expect(publicStatus(new HealthState({ provider: "fake", capUsd: null }), AT)).toEqual({ ok: true, staleFeeds: [], resting: false });
  });
});

describe("GET /status", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  async function start(health: HealthState): Promise<string> {
    server = createWorkerServer({ health, routes: statusRoutes({ health, origins: new Set(["https://botfolio.test"]), clientIp: () => "1.2.3.4", now: () => AT.getTime() }) });
    await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/status`;
  }

  it("answers with only the public fields, CORS and a short cache", async () => {
    const res = await fetch(await start(degraded()), { headers: { origin: "https://botfolio.test" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://botfolio.test");
    expect(res.headers.get("cache-control")).toBe("public, max-age=30");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, staleFeeds: ["SOL", "GOLD"], resting: true });
    for (const secret of ["RELAYER", "rpc1", "runner", "spent", "xai", "0x111"]) expect(text).not.toContain(secret);
  });

  it("limits each IP", async () => {
    const url = await start(new HealthState({ provider: "fake", capUsd: null }));
    for (let i = 0; i < STATUS_PER_IP_PER_MINUTE; i++) expect((await fetch(url)).status).toBe(200);
    const res = await fetch(url);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });
});
