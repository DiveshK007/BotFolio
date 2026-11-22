import {
  RELAY_AUTH_KIND_HEADER,
  SIWE_STATEMENT,
  type AuthNonceResponse,
  type AuthVerifySuccess,
} from "@botfolio/shared";
import { describe, expect, it, vi } from "vitest";
import { createSiweMessage } from "viem/siwe";
import type { HDAccount } from "viem/accounts";
import { authedRoute, type AuthedRouteOptions } from "../../src/auth/middleware";
import { authRoutes } from "../../src/auth/routes";
import { setUpAuth } from "../../src/auth/setup";
import { Throttle } from "../../src/auth/throttle";
import { HealthState } from "../../src/health";
import { relayRoutes } from "../../src/relay/route";
import { createWorkerServer } from "../../src/server";
import { OTHER, USER, fakeRelay, lower, signedRequest } from "../relay/helpers/fakes";
import { serve } from "../relay/helpers/http";
import { APP_ID, APP_SECRET, fakePrivy } from "./helpers/privy";

const WEB = "https://botfolio.example";
const ENV = {
  RELAY_JWT_SECRET: "unit-test-only-signing-key-0123456789abcdef",
  SIWE_DOMAIN: "botfolio.example",
  NEXT_PUBLIC_PRIVY_APP_ID: APP_ID,
  PRIVY_APP_SECRET: APP_SECRET,
};

async function worker(env: Record<string, string> = ENV, verifiesPerMinute = 30) {
  const privy = await fakePrivy([USER.address]);
  const auth = setUpAuth(env, { fetch: privy.fetch });
  const origins = new Set([WEB]);
  const log = vi.fn();
  const clientIp = () => "203.0.113.9";
  const handle = vi.fn<AuthedRouteOptions["handle"]>(async ({ identity }) => ({ status: 200, body: { ok: true, identity } }));
  const relay = fakeRelay({ auth: auth.authenticator });
  const health = new HealthState({ provider: "fake", capUsd: null });
  const routes = {
    ...authRoutes({ origins, clientIp, log, siwe: auth.siwe, throttle: new Throttle(verifiesPerMinute, 60_000) }),
    ...relayRoutes({ origins, relay: relay.relay }),
    ...authedRoute({ path: "/persona", origins, auth: auth.authenticator, log, handle }),
  };
  const base = await serve(createWorkerServer({ health, routes }));

  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB, ...headers },
      body: JSON.stringify(body),
    });
    return { status: res.status, headers: res.headers, body: (await res.json()) as any };
  };
  const as = (kind: string, token: string) => ({ authorization: `Bearer ${token}`, [RELAY_AUTH_KIND_HEADER]: kind });

  async function siweToken(account: HDAccount = USER): Promise<string> {
    const issued = (await (await fetch(`${base}/auth/nonce`)).json()) as AuthNonceResponse;
    const message = createSiweMessage({
      domain: ENV.SIWE_DOMAIN,
      address: account.address,
      statement: SIWE_STATEMENT,
      uri: `${WEB}/create`,
      version: "1",
      chainId: 1990,
      nonce: issued.nonce,
      issuedAt: new Date(issued.issuedAt),
    });
    const res = await post("/auth/verify", { message, signature: await account.signMessage({ message }) });
    expect(res.status).toBe(200);
    return (res.body as AuthVerifySuccess).token;
  }

  return { base, post, as, siweToken, privy, relay, handle, log };
}

describe("relay auth end to end (#186)", () => {
  it("accepts a SIWE JWT on /relay", async () => {
    const w = await worker();
    const res = await w.post("/relay", { request: await signedRequest() }, w.as("siwe", await w.siweToken()));
    expect(res.body).toMatchObject({ ok: true, status: "submitted" });
  });

  it("accepts a Privy token on /relay, counted against the same wallet", async () => {
    const w = await worker();
    const request = await signedRequest();
    expect((await w.post("/relay", { request }, w.as("privy", await w.privy.token()))).status).toBe(200);
    await w.post("/relay", { request }, w.as("siwe", await w.siweToken()));
    expect(w.relay.guard.reserve.mock.calls.map(([a]) => a.wallet)).toEqual([lower(USER.address), lower(USER.address)]);
  });

  it.each(["siwe", "privy"])("%s can't relay for another wallet", async (kind) => {
    const w = await worker();
    const token = kind === "siwe" ? await w.siweToken() : await w.privy.token();
    const request = await signedRequest({}, undefined, OTHER);
    const res = await w.post("/relay", { request }, w.as(kind, token));
    expect(res.body.error.code).toBe("SIGNER_MISMATCH");
    expect(w.relay.sender.send).not.toHaveBeenCalled();
  });

  it("never tries a token against the other verifier", async () => {
    const w = await worker();
    const request = await signedRequest();
    const siwe = await w.siweToken();
    const privy = await w.privy.token();
    for (const headers of [
      w.as("privy", siwe),
      w.as("siwe", privy),
      w.as("admin", siwe),
      { authorization: `Bearer ${siwe}` },
      { [RELAY_AUTH_KIND_HEADER]: "siwe" },
    ] as Record<string, string>[]) {
      expect((await w.post("/relay", { request }, headers)).body.error.code).toBe("UNAUTHORIZED");
    }
    expect(w.relay.sender.send).not.toHaveBeenCalled();
  });

  it("fails closed when Privy is down", async () => {
    const w = await worker();
    w.privy.state.userStatus = 503;
    const res = await w.post("/relay", { request: await signedRequest() }, w.as("privy", await w.privy.token()));
    expect(res.body.error.code).toBe("INTERNAL");
    expect(w.relay.sender.send).not.toHaveBeenCalled();
  });

  it("throttles verify per IP", async () => {
    const w = await worker(ENV, 2);
    for (let i = 0; i < 2; i++) expect((await w.post("/auth/verify", {})).status).toBe(400);
    const res = await w.post("/auth/verify", {});
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it.each([
    ["missing", ""],
    ["the .env.example placeholder", "replace-me"],
    ["a padded placeholder", `replace-me-${"0".repeat(40)}`],
    ["too short", "abc123"],
  ])("won't issue or accept a JWT when the secret is %s", async (_name, RELAY_JWT_SECRET) => {
    const good = await worker();
    const token = await good.siweToken();
    const w = await worker({ ...ENV, RELAY_JWT_SECRET });
    expect((await fetch(`${w.base}/auth/nonce`)).status).toBe(503);
    expect((await w.post("/auth/verify", {})).status).toBe(503);
    expect((await w.post("/relay", { request: await signedRequest() }, w.as("siwe", token))).body.error.code).toBe("INTERNAL");
    expect(w.relay.sender.send).not.toHaveBeenCalled();
  });

  it.each(Object.keys(ENV))("reports a missing %s by name only", (name) => {
    expect(setUpAuth({ ...ENV, [name]: "" }).problems).toEqual([name]);
    expect(setUpAuth({ ...ENV, [name]: "replace-me" }).problems).toEqual([name]);
  });

  it("answers the preflight on both auth routes", async () => {
    const w = await worker();
    for (const path of ["/auth/nonce", "/auth/verify"]) {
      expect((await fetch(w.base + path, { method: "OPTIONS", headers: { origin: WEB } })).status).toBe(204);
    }
  });
});

describe("authedRoute, for POST /persona (#186)", () => {
  it("passes the proven identity, not the body's", async () => {
    const w = await worker();
    const res = await w.post("/persona", { wallet: OTHER.address }, w.as("privy", await w.privy.token()));
    expect(res.body.identity.wallets).toEqual([lower(USER.address)]);
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
  });

  it("401s before the handler runs", async () => {
    const w = await worker();
    const res = await w.post("/persona", {});
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
    expect(w.handle).not.toHaveBeenCalled();
  });

  it("caps the body", async () => {
    const w = await worker();
    const res = await w.post("/persona", { x: "x".repeat(20_000) }, w.as("siwe", await w.siweToken()));
    expect(res.status).toBe(400);
    expect(w.handle).not.toHaveBeenCalled();
  });

  it("hides a handler's failure", async () => {
    const w = await worker();
    w.handle.mockRejectedValue(new Error("postgres://user:hunter2@db"));
    const res = await w.post("/persona", {}, w.as("siwe", await w.siweToken()));
    expect(res.status).toBe(500);
    expect(JSON.stringify([res.body, w.log.mock.calls])).not.toContain("hunter2");
  });
});
