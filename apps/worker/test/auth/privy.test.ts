import { SignJWT, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { PrivyVerifier } from "../../src/auth/privy";
import { OTHER, USER, lower } from "../relay/helpers/fakes";
import { APP_ID, APP_SECRET, DID, fakePrivy } from "./helpers/privy";

async function setup() {
  const privy = await fakePrivy([USER.address]);
  let skew = 0;
  const verifier = new PrivyVerifier({ appId: APP_ID, appSecret: APP_SECRET, fetch: privy.fetch, now: () => Date.now() + skew });
  return { privy, verifier, advance: (ms: number) => (skew += ms) };
}

describe("Privy token, verified server-side (#186)", () => {
  it("returns the wallets Privy holds for that DID, looked up with the app secret", async () => {
    const { privy, verifier } = await setup();
    expect(await verifier.verify(await privy.token())).toEqual({ did: DID, wallets: [lower(USER.address)] });
    const headers = privy.lookups()[0]![1]!.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from(`${APP_ID}:${APP_SECRET}`).toString("base64")}`);
    expect(headers["privy-app-id"]).toBe(APP_ID);
  });

  it("ignores a wallet claimed inside the token", async () => {
    const { privy, verifier } = await setup();
    const token = await privy.token({ wallet: OTHER.address, linked_accounts: [{ address: OTHER.address }] });
    expect((await verifier.verify(token))!.wallets).toEqual([lower(USER.address)]);
  });

  it("keeps only Ethereum wallets, embedded first", async () => {
    const { privy, verifier } = await setup();
    privy.state.accounts.unshift(
      { type: "wallet", chain_type: "ethereum", connector_type: "injected", address: OTHER.address },
      { type: "wallet", chain_type: "solana", address: "So11111111111111111111111111111111111111112" },
      { type: "smart_wallet", chain_type: "ethereum", address: `0x${"9".repeat(40)}` },
      { type: "email", address: "someone@example.com" },
    );
    expect((await verifier.verify(await privy.token()))!.wallets).toEqual([lower(USER.address), lower(OTHER.address)]);
  });

  it.each([
    ["another app's audience", { aud: "clsomeotherapp000000" }],
    ["an audience list", { aud: [APP_ID, "clsomeotherapp000000"] }],
    ["another issuer", { iss: "evil.example" }],
    ["expired", { exp: Math.floor(Date.now() / 1000) - 1 }],
    ["no exp", { exp: undefined }],
    ["no sid", { sid: undefined }],
    ["no sub", { sub: undefined }],
    ["a sub that isn't a DID", { sub: "../../apps" }],
  ])("refuses a token with %s, without a user lookup", async (_name, claims) => {
    const { privy, verifier } = await setup();
    expect(await verifier.verify(await privy.token(claims))).toBeNull();
    expect(privy.lookups()).toHaveLength(0);
  });

  it("refuses another key, HS256 and alg none", async () => {
    const { privy, verifier } = await setup();
    const { privateKey } = await generateKeyPair("ES256");
    expect(await verifier.verify(await privy.token({}, privateKey))).toBeNull();

    const real = await privy.token();
    const payload = JSON.parse(Buffer.from(real.split(".")[1]!, "base64url").toString());
    const hs256 = await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: "k1" })
      .sign(new TextEncoder().encode(APP_SECRET.repeat(2)));
    expect(await verifier.verify(hs256)).toBeNull();

    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${real.split(".")[1]}.`;
    expect(await verifier.verify(none)).toBeNull();
  });

  it("refuses a deleted user", async () => {
    const { privy, verifier } = await setup();
    privy.state.userStatus = 404;
    expect(await verifier.verify(await privy.token())).toBeNull();
  });

  it.each([
    ["JWKS down", { jwksStatus: 503 }],
    ["API down", { userStatus: 503 }],
    ["rate limited", { userStatus: 429 }],
    ["bad app secret", { userStatus: 401 }],
    ["another user's record", { userId: "did:privy:someoneelse" }],
  ])("throws, never signs in, with %s", async (_name, state) => {
    const { privy, verifier } = await setup();
    Object.assign(privy.state, state);
    await expect(verifier.verify(await privy.token())).rejects.toMatchObject({ name: "InternalFailure" });
  });

  it("shares one lookup for a burst, and sees a new wallet a few seconds later", async () => {
    const { privy, verifier, advance } = await setup();
    const token = await privy.token();
    await Promise.all(Array.from({ length: 20 }, () => verifier.verify(token)));
    expect(privy.lookups()).toHaveLength(1);
    privy.state.accounts.push({ type: "wallet", chain_type: "ethereum", address: OTHER.address });
    advance(3_001);
    expect((await verifier.verify(token))!.wallets).toContain(lower(OTHER.address));
  });
});

describe("Deleting a Privy user (#174)", () => {
  const deleter = (status: number) => {
    const calls: [string, RequestInit][] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response(null, { status });
    }) as unknown as typeof globalThis.fetch;
    return { calls, verifier: new PrivyVerifier({ appId: APP_ID, appSecret: APP_SECRET, fetch }) };
  };

  it.each([200, 204, 404])("sends DELETE with the app secret, and %i counts as deleted", async (status) => {
    const { calls, verifier } = deleter(status);
    await verifier.deleteUser(DID);
    expect(calls[0]![0]).toBe(`https://api.privy.io/v1/users/${encodeURIComponent(DID)}`);
    expect(calls[0]![1].method).toBe("DELETE");
    expect((calls[0]![1].headers as Record<string, string>)["privy-app-id"]).toBe(APP_ID);
  });

  it.each([401, 429, 500])("throws on %i", async (status) => {
    await expect(deleter(status).verifier.deleteUser(DID)).rejects.toMatchObject({ reason: `privy_api_${status}` });
  });
});
