import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { SIWE_NONCE_TTL_SECONDS, type AuthNonceResponse } from "@botfolio/shared";

const NONCE = /^(\d{10})([0-9a-f]{32})([0-9a-f]{64})$/;

export type NonceState = "valid" | "invalid" | "expired";

/**
 * Single-use SIWE nonces that cost no memory to issue: expiry + random + HMAC under a key made at boot.
 * A GET flood therefore can't fill a store or push out other users' nonces. Memory holds only consumed nonces
 * (each needs a valid signature), for at most 5 minutes and up to a hard cap. Full = refuse.
 *
 * Single instance: a restart drops the key, so outstanding nonces die and none can be replayed across it.
 */
export class NonceService {
  private readonly key = randomBytes(32);
  private readonly consumed = new Map<string, number>();
  private nextSweep = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxConsumed = 100_000,
  ) {}

  issue(): AuthNonceResponse {
    const now = this.now();
    const expires = Math.floor(now / 1000) + SIWE_NONCE_TTL_SECONDS;
    const body = `${expires}${randomBytes(16).toString("hex")}`;
    return {
      nonce: body + this.mac(body).toString("hex"),
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  check(nonce: string): NonceState {
    const match = NONCE.exec(nonce);
    if (!match) return "invalid";
    const [, expires, random, mac] = match;
    if (!timingSafeEqual(this.mac(`${expires}${random}`), Buffer.from(mac!, "hex"))) return "invalid";
    if (this.now() >= Number(expires) * 1000) return "expired";
    return this.consumed.has(nonce) ? "invalid" : "valid";
  }

  /** Synchronous check-and-mark, so two concurrent verifies can't both win. */
  consume(nonce: string): NonceState | "full" {
    const state = this.check(nonce);
    if (state !== "valid") return state;
    this.sweep();
    if (this.consumed.size >= this.maxConsumed) return "full";
    this.consumed.set(nonce, Number(nonce.slice(0, 10)) * 1000);
    return "valid";
  }

  private mac(body: string): Buffer {
    return createHmac("sha256", this.key).update(body).digest();
  }

  private sweep(): void {
    const now = this.now();
    if (now < this.nextSweep) return;
    this.nextSweep = now + 1_000;
    for (const [nonce, expires] of this.consumed) if (expires <= now) this.consumed.delete(nonce);
  }
}
