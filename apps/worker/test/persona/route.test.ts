import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { FakeLlmClient, loadLlmConfig } from "@botfolio/llm";
import { keccak256, stringToBytes, type Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthenticator } from "../../src/auth/authenticator";
import { RelayJwt } from "../../src/auth/jwt";
import type { Authenticator } from "../../src/auth/types";
import { hashJson } from "../../src/canonical";
import { HealthState } from "../../src/health";
import { DRAFTS_KEPT, personaDraft } from "../../src/persona/drafts";
import { PERSONA_PER_WALLET_PER_DAY, personaRoutes } from "../../src/persona/route";
import type { Db, Queryable } from "../../src/relay/db";
import { createWorkerServer } from "../../src/server";
import { parsePersonaDraft } from "../../../web/lib/persona";

const SCHEMA = readFileSync(new URL("../../../../packages/db/schema.sql", import.meta.url), "utf8");
const WALLET = `0x${"a1".repeat(20)}` as const;
const ORIGIN = "https://app.example";
const PERSONA = {
  name: "AlphaWolf",
  emoji: "🐺",
  persona: "Bold, loud, loves momentum.",
  rules: "Buys strength, cuts losers.",
  max_per_coin_pct: 40,
  max_trades_per_day: 4,
};
const jwt = new RelayJwt("test-only-secret-".padEnd(40, "x"));

let pg: PGlite;
let db: Db;
let llm: FakeLlmClient;
let servers: Server[];
const log = vi.fn();

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
  const on = (runner: Pick<PGlite, "query">): Queryable => ({
    query: async <Row>(sql: string, params?: unknown[]) => ({ rows: (await runner.query<Row>(sql, params)).rows }),
  });
  db = { ...on(pg), transaction: (run) => pg.transaction((tx) => run(on(tx))), close: async () => {} };
  llm = new FakeLlmClient([PERSONA]);
  servers = [];
  log.mockClear();
}, 30_000);

afterEach(async () => {
  for (const server of servers) await new Promise((done) => server.close(done));
  await pg.close();
});

async function serve(opts: { auth?: Authenticator; capUsd?: number; off?: boolean } = {}) {
  const health = new HealthState({ provider: "fake", capUsd: opts.capUsd ?? null });
  const routes = personaRoutes({
    origins: new Set([ORIGIN]),
    auth: opts.auth ?? createAuthenticator({ jwt, privy: null }),
    clientIp: () => "203.0.113.7",
    log,
    service: opts.off ? null : { db, llm, health, config: loadLlmConfig({ LLM_PROVIDER: "fake" }) },
  });
  const server = createWorkerServer({ health, routes });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/persona`;
  const { token } = await jwt.sign(WALLET);
  return async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        authorization: `Bearer ${token}`,
        "x-botfolio-auth": "siwe",
        ...headers,
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, cors: res.headers.get("access-control-allow-origin"), body: (await res.json()) as any };
  };
}

const ok = { sentence: "Bold momentum wolf", termsAccepted: true };
const users = async () => (await pg.query<any>("select * from users")).rows;

describe("POST /persona", () => {
  it("answers in the shape apps/web parses, with CORS for the app", async () => {
    const res = await (await serve())(ok);
    expect(res.status).toBe(200);
    expect(res.cors).toBe(ORIGIN);
    // The web app's own parser: the two can't drift.
    expect(parsePersonaDraft(res.body)?.persona.limits).toEqual({ maxPerCoinPct: 40, maxTradesPerDay: 4 });
    const { max_per_coin_pct: _p, max_trades_per_day: _t, ...hashed } = res.body.persona;
    expect(res.body.personaHash).toBe(hashJson(hashed));
  });

  it("personaHash is keccak256 of the persona's canonical JSON, byte for byte (#219)", async () => {
    const res = await (await serve())(ok);
    const text = '{"emoji":"🐺","name":"AlphaWolf","persona":"Bold, loud, loves momentum.","rules":"Buys strength, cuts losers."}';
    expect(res.body.personaHash).toBe(keccak256(stringToBytes(text)));
  });

  it("stores the 18+ acceptance and a draft the runner can find by owner and hash", async () => {
    const res = await (await serve())(ok);
    const [user] = await users();
    expect(user.wallet_address).toBe(WALLET);
    expect(user.login_method).toBe("qie_wallet");
    expect(user.terms_accepted_at).toBeTruthy();
    const draft = await personaDraft(db as never, WALLET, res.body.personaHash as Hex);
    expect(draft).toMatchObject({ name: "AlphaWolf", rules: PERSONA.rules });
    expect(await personaDraft(db as never, `0x${"b2".repeat(20)}`, res.body.personaHash as Hex)).toBeNull();
  });

  it("the first acceptance stands", async () => {
    const post = await serve();
    await post(ok);
    await pg.exec("update users set terms_accepted_at = '2026-11-01T00:00:00Z'");
    await post(ok);
    expect(new Date((await users())[0].terms_accepted_at).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it.each([
    ["no tick", { sentence: "Bold wolf" }, "TERMS_NOT_ACCEPTED"],
    ["a truthy tick", { sentence: "Bold wolf", termsAccepted: "true" }, "TERMS_NOT_ACCEPTED"],
    ["no sentence", { termsAccepted: true }, "BAD_REQUEST"],
    ["161 characters", { sentence: "a".repeat(161), termsAccepted: true }, "BAD_REQUEST"],
    ["only a link", { sentence: "https://evil.example", termsAccepted: true }, "BAD_REQUEST"],
  ])("refuses %s without calling the LLM or storing anything", async (_name, body, code) => {
    const res = await (await serve())(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
    expect(llm.calls).toHaveLength(0);
    expect(await users()).toEqual([]);
  });

  it("needs a verified sign-in", async () => {
    const res = await (await serve())(ok, { authorization: "Bearer a.b.c" });
    expect(res.status).toBe(401);
    expect(llm.calls).toHaveLength(0);
  });

  it("takes the wallet from the token, never from the body", async () => {
    await (await serve())({ ...ok, wallet: `0x${"ee".repeat(20)}`, address: `0x${"ee".repeat(20)}` });
    expect((await users())[0].wallet_address).toBe(WALLET);
  });

  it("a Privy user's embedded wallet owns the draft", async () => {
    const embedded = `0x${"c3".repeat(20)}` as const;
    const auth: Authenticator = {
      authenticate: async () => ({ kind: "privy", wallets: [embedded, WALLET], privyDid: "did:privy:abc" }),
    };
    await (await serve({ auth }))(ok);
    expect(await users()).toMatchObject([{ wallet_address: embedded, login_method: "passkey", privy_did: "did:privy:abc" }]);
  });

  it("limits each wallet per day, before the LLM is called", async () => {
    const post = await serve();
    for (let i = 0; i < PERSONA_PER_WALLET_PER_DAY; i++) expect((await post(ok)).status).toBe(200);
    const res = await post(ok);
    expect(res.status).toBe(429);
    expect(llm.calls).toHaveLength(PERSONA_PER_WALLET_PER_DAY);
  });

  it("keeps a bounded number of drafts", async () => {
    let n = 0;
    llm = new FakeLlmClient(() => ({ ...PERSONA, name: `Wolf ${n++}` }));
    const post = await serve();
    for (let i = 0; i < DRAFTS_KEPT + 2; i++) await post(ok);
    expect(Object.keys((await users())[0].flags.personas)).toHaveLength(DRAFTS_KEPT);
  });

  it("broken model output is a 502 that neither stores nor logs what the model wrote", async () => {
    llm = new FakeLlmClient([{ ...PERSONA, secret_key_from_model: "x" }]);
    const res = await (await serve())(ok);
    expect(res.status).toBe(502);
    expect(await users()).toEqual([]);
    expect(JSON.stringify(log.mock.calls) + JSON.stringify(res.body)).not.toContain("secret_key_from_model");
  });

  it("rests with the budget used up", async () => {
    const res = await (await serve({ capUsd: 0 }))(ok);
    expect(res.status).toBe(503);
    expect(llm.calls).toHaveLength(0);
  });

  it("carries an optional dnaSeed into the draft without changing personaHash", async () => {
    const post = await serve();
    const res = await post({ ...ok, dnaSeed: "pet-4242-wolf" });
    expect(res.status).toBe(200);
    expect(res.body.dnaSeed).toBe("pet-4242-wolf");
    expect(parsePersonaDraft(res.body)?.dnaSeed).toBe("pet-4242-wolf");
    const draft = await personaDraft(db as never, WALLET, res.body.personaHash as Hex);
    expect(draft?.dnaSeed).toBe("pet-4242-wolf");
    const bad = await post({ ...ok, dnaSeed: "<script>" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("BAD_REQUEST");
  });

  it("is off until configured", async () => {
    const res = await (await serve({ off: true }))(ok);
    expect(res.body.error.code).toBe("PERSONA_DISABLED");
  });
});
