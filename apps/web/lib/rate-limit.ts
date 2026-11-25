/**
 * Per-IP limits for the public web API (#156, documented in docs/public-api.md).
 *
 * Why limit here and not only on the worker: the web's server-side fetches to the worker all come from Vercel's
 * IPs, so the worker's per-IP limits see one "client" for everyone. Here we still see the real caller.
 */

/** Same rate as the MCP server, which serves the same record (SPEC §10.1). */
export const API_V1_PER_IP_PER_MINUTE = 60;

/**
 * Fixed window per key, bounded: when full, the oldest key is dropped. Same logic as the worker's Throttle.
 * shortcut: in-memory, so each Vercel instance counts on its own and a cold start resets it; an IP spread over
 * several instances gets more than the limit. Upgrade to a shared store (Upstash/Vercel KV) if the API is abused.
 */
export class RateLimit {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly maxKeys = 50_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** null = allowed, otherwise the seconds to wait. */
  take(key: string): number | null {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
      this.windows.delete(key); // re-inserted at the end, so the map stays oldest-first
      if (this.windows.size >= this.maxKeys) this.windows.delete(this.windows.keys().next().value!);
      window = { start: now, count: 0 };
      this.windows.set(key, window);
    }
    if (window.count >= this.limit) return Math.max(1, Math.ceil((window.start + this.windowMs - now) / 1000));
    window.count++;
    return null;
  }
}

/**
 * The caller's IP. UNVERIFIED: that Vercel sets `x-real-ip` and overwrites `x-forwarded-for` with the real client
 * IP, so a client can't pick its own (Vercel docs say so; not yet checked against a deployed request). Off Vercel
 * these headers are client-controlled. No header → one shared "unknown" bucket: too strict, not bypassable.
 * shortcut: IPv6 is keyed per address, not per /64 like the worker; key by /64 if rotation abuse shows up.
 */
export function clientIp(headers: Headers): string {
  const ip = headers.get("x-real-ip")?.trim() || headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return ip ? ip.toLowerCase() : "unknown";
}

/** null = go ahead; otherwise the 429 to send back. */
export function limitByIp(req: Request, limiter: RateLimit, headers: Record<string, string> = {}): Response | null {
  const wait = limiter.take(clientIp(req.headers));
  if (wait === null) return null;
  return Response.json(
    { error: { code: "RATE_LIMITED", message: `Too many requests: ${limiter.limit} a minute per IP. Wait ${wait} s.`, retryAfterSeconds: wait } },
    { status: 429, headers: { ...headers, "cache-control": "no-store", "retry-after": String(wait) } },
  );
}
