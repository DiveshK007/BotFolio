import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { vi } from "vitest";
import type { Address } from "viem";

export const APP_ID = "cltestappid0000000000000";
export const APP_SECRET = "test-privy-app-secret-not-real";
export const DID = "did:privy:cltestuser000001";

/** Stands in for api.privy.io: a JWKS, a user lookup and a token minter with real ES256 keys. */
export async function fakePrivy(wallets: Address[]) {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  const state = {
    jwksStatus: 200,
    userStatus: 200,
    userId: DID,
    accounts: wallets.map((address): Record<string, unknown> => ({
      type: "wallet",
      chain_type: "ethereum",
      connector_type: "embedded",
      address,
    })),
  };
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === `https://api.privy.io/v1/apps/${APP_ID}/jwks.json`) {
      return Response.json({ keys: [jwk] }, { status: state.jwksStatus });
    }
    if (url === `https://api.privy.io/v1/users/${encodeURIComponent(DID)}`) {
      return Response.json({ id: state.userId, linked_accounts: state.accounts }, { status: state.userStatus });
    }
    throw new Error("unexpected url");
  });

  async function token(over: Record<string, unknown> = {}, key: CryptoKey = privateKey) {
    const iat = Math.floor(Date.now() / 1000);
    const payload = { sub: DID, sid: "session1", iss: "privy.io", aud: APP_ID, iat, exp: iat + 3600, ...over };
    return new SignJWT(JSON.parse(JSON.stringify(payload))).setProtectedHeader({ alg: "ES256", typ: "JWT", kid: "k1" }).sign(key);
  }

  const lookups = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/users/"));
  return { state, fetch: fetchMock, token, lookups };
}
