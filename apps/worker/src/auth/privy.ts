import { createRemoteJWKSet, customFetch, errors, jwtVerify } from "jose";
import type { Address } from "viem";
import { InternalFailure } from "./log";

const PRIVY_API = "https://api.privy.io";
const TIMEOUT_MS = 5_000;
/** Privy rate-limits user lookups, and one valid token must not be able to exhaust that for everyone. */
const LOOKUP_CACHE_MS = 3_000;
const MAX_CACHED_USERS = 10_000;

/** jose errors that mean "couldn't check", as opposed to "bad token". */
const UNAVAILABLE = new Set(["ERR_JOSE_GENERIC", "ERR_JWKS_TIMEOUT", "ERR_JWKS_INVALID"]);

export interface PrivyUser {
  did: string;
  wallets: Address[];
}

interface PrivyOptions {
  appId: string;
  appSecret: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * Privy access token → DID → that user's wallets, both steps server-side.
 * The token doesn't name wallets and the client's word is never used: they come from Privy's REST API with the
 * app secret. Token format and endpoints follow Privy's docs and @privy-io/node 0.42 (read Nov 22).
 * UNVERIFIED against a real Privy app (#71).
 */
export class PrivyVerifier {
  private readonly keys: ReturnType<typeof createRemoteJWKSet>;
  private readonly users = new Map<string, { at: number; wallets: Promise<Address[] | null> }>();
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly opts: PrivyOptions) {
    this.fetch = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.keys = createRemoteJWKSet(new URL(`${PRIVY_API}/v1/apps/${opts.appId}/jwks.json`), {
      timeoutDuration: TIMEOUT_MS,
      [customFetch]: this.fetch,
    });
  }

  async verify(token: string): Promise<PrivyUser | null> {
    const did = await this.verifiedDid(token);
    if (!did) return null;
    const wallets = await this.walletsOf(did);
    return wallets && { did, wallets };
  }

  private async verifiedDid(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        algorithms: ["ES256"],
        issuer: "privy.io",
        audience: this.opts.appId,
        typ: "JWT",
        requiredClaims: ["sub", "sid", "iat", "exp"],
        currentDate: new Date(this.now()),
      });
      if (payload.aud !== this.opts.appId) return null;
      const { sub } = payload;
      return typeof sub === "string" && /^did:privy:[A-Za-z0-9]{1,64}$/.test(sub) ? sub : null;
    } catch (error) {
      if (error instanceof errors.JOSEError && !UNAVAILABLE.has(error.code)) return null;
      throw new InternalFailure("privy_keys_unavailable");
    }
  }

  private walletsOf(did: string): Promise<Address[] | null> {
    const now = this.now();
    const cached = this.users.get(did);
    if (cached && now - cached.at < LOOKUP_CACHE_MS) return cached.wallets;

    this.users.delete(did);
    if (this.users.size >= MAX_CACHED_USERS) this.users.delete(this.users.keys().next().value!);
    const wallets = this.lookUp(did);
    this.users.set(did, { at: now, wallets });
    return wallets;
  }

  /**
   * Deletes the Privy user, and with it the embedded wallet Privy keeps for them (#174). A user that is already
   * gone counts as deleted. UNVERIFIED: `DELETE /v1/users/{did}` and its 204 are from Privy's API docs, not tried
   * against a real Privy app (#71).
   */
  async deleteUser(did: string): Promise<void> {
    let status: number;
    try {
      const res = await this.fetch(`${PRIVY_API}/v1/users/${encodeURIComponent(did)}`, {
        method: "DELETE",
        headers: this.apiHeaders(),
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
    } catch {
      throw new InternalFailure("privy_api_unreachable");
    }
    this.users.delete(did);
    if (status !== 200 && status !== 204 && status !== 404) throw new InternalFailure(`privy_api_${status}`);
  }

  private apiHeaders() {
    const { appId, appSecret } = this.opts;
    return { authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`, "privy-app-id": appId };
  }

  private async lookUp(did: string): Promise<Address[] | null> {
    let status: number;
    let user: { id?: unknown; linked_accounts?: unknown } | null;
    try {
      const res = await this.fetch(`${PRIVY_API}/v1/users/${encodeURIComponent(did)}`, {
        headers: this.apiHeaders(),
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
      user = status === 200 ? ((await res.json()) as typeof user) : null;
    } catch {
      throw new InternalFailure("privy_api_unreachable");
    }
    if (status === 404) return null; // deleted user
    if (status !== 200) throw new InternalFailure(`privy_api_${status}`);
    if (user?.id !== did || !Array.isArray(user.linked_accounts)) throw new InternalFailure("privy_api_bad_body");

    // Embedded first, so a caller that needs one wallet gets the passkey one.
    const embedded: Address[] = [];
    const external: Address[] = [];
    for (const account of user.linked_accounts as Record<string, unknown>[]) {
      if (account?.type !== "wallet" || account.chain_type !== "ethereum") continue;
      if (typeof account.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(account.address)) continue;
      (account.connector_type === "embedded" ? embedded : external).push(account.address.toLowerCase() as Address);
    }
    return [...embedded, ...external];
  }
}
