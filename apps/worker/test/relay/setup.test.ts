import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { setUpAuth } from "../../src/auth/setup";
import type { Env } from "../../src/auth/env";
import type { Db } from "../../src/relay/db";
import { setUpRelayer } from "../../src/relay/setup";
import { HealthState } from "../../src/health";
import { relayRoutes } from "../../src/relay/route";
import { createWorkerServer } from "../../src/server";
import { FORWARDER, TARGETS, signedRequest } from "./helpers/fakes";
import { fakeNode, serve } from "./helpers/http";

const key = generatePrivateKey();

const GOOD: Env = {
  RELAY_ENABLED: "true",
  RELAYER_PRIVATE_KEY: key,
  DATABASE_URL: "postgres://relay:pw@127.0.0.1:5432/botfolio",
  RELAY_JWT_SECRET: "unit-test-only-signing-key-0123456789abcdef",
  SIWE_DOMAIN: "botfolio.example",
  NEXT_PUBLIC_PRIVY_APP_ID: "cltestappid0000000000000",
  PRIVY_APP_SECRET: "test-privy-app-secret-not-real",
  FORWARDER_ADDRESS: FORWARDER,
  BOT_REGISTRY_ADDRESS: TARGETS.BotRegistry,
  SEASON_LEDGER_ADDRESS: TARGETS.SeasonLedger,
  PAPER_LEDGER_ADDRESS: TARGETS.PaperLedger,
  DAILY_CALL_ADDRESS: TARGETS.DailyCall,
  CHALLENGES_ADDRESS: TARGETS.Challenges,
};

const deadDb: Db = {
  query: () => Promise.reject(new Error("db down")),
  transaction: () => Promise.reject(new Error("db down")),
  close: async () => {},
};

function setup(env: Env, rpcUrls = ["http://127.0.0.1:9"]) {
  const openDatabase = vi.fn(() => deadDb);
  const log = vi.fn();
  return { openDatabase, log, service: setUpRelayer({ env, auth: setUpAuth(env), rpcUrls, log, openDatabase }) };
}

describe("relayer wiring fails closed (#40)", () => {
  it("starts with a complete env", () => {
    expect(setup(GOOD).service.relay).not.toBeNull();
  });

  it.each([undefined, "", "false", "TRUE", "1", "yes"])("is off when RELAY_ENABLED is %j", (RELAY_ENABLED) => {
    const { service, openDatabase } = setup({ ...GOOD, RELAY_ENABLED });
    expect(service.relay).toBeNull();
    expect(service.problems).toEqual(["RELAY_ENABLED"]);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  describe.each(Object.keys(GOOD).filter((name) => name !== "RELAY_ENABLED"))("%s", (name) => {
    it.each([undefined, "", "replace-me"])("= %j switches the relay off and is named", (value) => {
      const { service, openDatabase } = setup({ ...GOOD, [name]: value });
      expect(service.relay).toBeNull();
      expect(service.problems).toContain(name);
      expect(openDatabase).not.toHaveBeenCalled();
    });
  });

  it.each(["RUNNER_PRIVATE_KEY", "COMMITTER_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"])(
    "refuses a relayer key that is also %s",
    (name) => {
      const { service } = setup({ ...GOOD, [name]: key.slice(2).toUpperCase() });
      expect(service.relay).toBeNull();
      expect(service.problems).toEqual(["RELAYER_PRIVATE_KEY"]);
    },
  );

  it.each(["0".repeat(64), "f".repeat(64), "0x1234"])("refuses a bad key without echoing it (%#)", (bad) => {
    const { service, log } = setup({ ...GOOD, RELAYER_PRIVATE_KEY: bad });
    expect(service.relay).toBeNull();
    expect(JSON.stringify([service.problems, log.mock.calls])).not.toContain(bad);
  });

  it("is off with a bad limit", () => {
    expect(setup({ ...GOOD, RELAY_MAX_GLOBAL_PER_HOUR: "unlimited" }).service.problems).toEqual(["RELAY_MAX_GLOBAL_PER_HOUR"]);
  });

  it("answers RELAY_DISABLED over HTTP when RELAY_ENABLED=false", async () => {
    const { service } = setup({ ...GOOD, RELAY_ENABLED: "false" });
    const health = new HealthState({ provider: "fake", capUsd: null });
    const base = await serve(createWorkerServer({ health, routes: relayRoutes({ relay: service.relay, origins: new Set() }) }));
    const res = await fetch(`${base}/relay`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(await res.json()).toMatchObject({ error: { code: "RELAY_DISABLED" } });
  });

  it("broadcasts nothing with the DB down", async () => {
    const node = await fakeNode(() => ({ result: "0x" }));
    const auth = setUpAuth(GOOD);
    const service = setUpRelayer({ env: GOOD, auth, rpcUrls: [node.url], log: vi.fn(), openDatabase: () => deadDb });
    const request = await signedRequest({ deadline: Math.floor(Date.now() / 1000) + 300 });
    const { token } = await auth.siwe!.jwt.sign(request.from);
    const headers = { authorization: `Bearer ${token}`, "x-botfolio-auth": "siwe" };
    const result = await service.relay!({ body: { request }, headers, ip: "x" });
    expect(result.body).toMatchObject({ error: { code: "INTERNAL" } });
    expect(node.calls).toHaveLength(0);
  });
});
