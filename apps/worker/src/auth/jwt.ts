import { RELAY_JWT_TTL_SECONDS, type RelayJwtClaims } from "@botfolio/shared";
import { SignJWT, errors, jwtVerify } from "jose";
import type { Address } from "viem";

const AUDIENCE: RelayJwtClaims["aud"] = "botfolio-relay";
const KIND: RelayJwtClaims["kind"] = "siwe";
const CLOCK_SKEW_SECONDS = 5;

/** The 15-min relay JWT (SPEC §11): HS256 only, bound to one lowercase address. */
export class RelayJwt {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly now: () => number = Date.now,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async sign(wallet: Address): Promise<{ token: string; expiresAt: string }> {
    const iat = Math.floor(this.now() / 1000);
    const exp = iat + RELAY_JWT_TTL_SECONDS;
    const token = await new SignJWT({ kind: KIND })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(wallet.toLowerCase())
      .setAudience(AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(this.key);
    return { token, expiresAt: new Date(exp * 1000).toISOString() };
  }

  async verify(token: string): Promise<Address | null> {
    try {
      const now = new Date(this.now());
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ["HS256"],
        audience: AUDIENCE,
        requiredClaims: ["sub", "aud", "kind", "iat", "exp"],
        currentDate: now,
      });
      const { sub, aud, kind, iat, exp } = payload;
      if (aud !== AUDIENCE || kind !== KIND) return null;
      if (typeof iat !== "number" || typeof exp !== "number") return null;
      if (exp - iat > RELAY_JWT_TTL_SECONDS || iat > now.getTime() / 1000 + CLOCK_SKEW_SECONDS) return null;
      return typeof sub === "string" && /^0x[0-9a-f]{40}$/.test(sub) ? (sub as Address) : null;
    } catch (error) {
      if (error instanceof errors.JOSEError) return null;
      throw error;
    }
  }
}
