import { SignJWT, decodeJwt, decodeProtectedHeader } from "jose";
import { describe, expect, it } from "vitest";
import { RelayJwt } from "../../src/auth/jwt";
import { USER, lower } from "../relay/helpers/fakes";

const SECRET = "unit-test-only-signing-key-0123456789abcdef";
const NOW_MS = 1_795_340_000_000;
const iat = NOW_MS / 1000;
const wallet = lower(USER.address);
const good = { sub: wallet, aud: "botfolio-relay", kind: "siwe", iat, exp: iat + 900 };
const jwt = (now = NOW_MS) => new RelayJwt(SECRET, () => now);

const sign = (claims: Record<string, unknown>, alg = "HS256", key = SECRET) =>
  new SignJWT(JSON.parse(JSON.stringify(claims))).setProtectedHeader({ alg }).sign(new TextEncoder().encode(key));

describe("relay JWT (#186)", () => {
  it("has exactly the frozen claims, lasts 15 min and is HS256", async () => {
    const { token, expiresAt } = await jwt().sign(USER.address);
    expect(decodeJwt(token)).toEqual(good);
    expect(decodeProtectedHeader(token).alg).toBe("HS256");
    expect(expiresAt).toBe(new Date(NOW_MS + 900_000).toISOString());
    expect(await jwt().verify(token)).toBe(wallet);
  });

  it("expires", async () => {
    const { token } = await jwt().sign(USER.address);
    expect(await jwt(NOW_MS + 899_000).verify(token)).toBe(wallet);
    expect(await jwt(NOW_MS + 900_000).verify(token)).toBeNull();
  });

  it.each([
    ["audience", { aud: "other" }],
    ["audience list", { aud: ["botfolio-relay", "other"] }],
    ["no audience", { aud: undefined }],
    ["kind", { kind: "privy" }],
    ["no kind", { kind: undefined }],
    ["no exp", { exp: undefined }],
    ["no iat", { iat: undefined }],
    ["lifetime over 15 min", { exp: iat + 901 }],
    ["future iat", { iat: iat + 60 }],
    ["no subject", { sub: undefined }],
    ["checksummed subject", { sub: USER.address }],
    ["subject that isn't an address", { sub: "admin" }],
  ])("refuses a bad %s", async (_name, over) => {
    expect(await jwt().verify(await sign({ ...good, ...over }))).toBeNull();
  });

  it.each(["HS384", "HS512"])("refuses %s even with the right key", async (alg) => {
    expect(await jwt().verify(await sign(good, alg))).toBeNull();
  });

  it("refuses alg none, another key and garbage", async () => {
    const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    expect(await jwt().verify(`${part({ alg: "none" })}.${part(good)}.`)).toBeNull();
    expect(await jwt().verify(await sign(good, "HS256", `${SECRET}x`))).toBeNull();
    expect(await jwt().verify("not.a.jwt")).toBeNull();
  });
});
