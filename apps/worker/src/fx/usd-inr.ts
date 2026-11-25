import { corsRoute } from "../auth/cors";
import { InternalFailure, type Log } from "../auth/log";
import { sendJson, type Routes } from "../server";

/**
 * USD/INR for the ₹ tooltip only (SPEC §3: "INR conversion approximate", cached daily).
 * Never feeds on-chain values, the gate or play balances: the ₹ figure itself is 100000 × value / startValue.
 *
 * Kept in memory, not in Postgres: schema.sql is frozen and has no table for it. A restart costs one fetch.
 */

export const USD_INR_PATH = "/fx/usd-inr";
/** Free and keyless; returns {"base":"USD","date":"2026-11-24","rates":{"INR":92.92}} (checked Nov 25 2026). */
export const DEFAULT_USDINR_SOURCE_URL = "https://api.frankfurter.dev/v1/latest?from=USD&to=INR";
/** frankfurter.dev on Nov 20 2026, the rate START_CASH_E8 was sized with (packages/contracts/README.md). */
export const USD_INR_FALLBACK = 92.68;
export const USD_INR_REFRESH_MS = 24 * 60 * 60_000;
/** After a failed fetch, try again sooner than a day. */
export const USD_INR_RETRY_MS = 60 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;

export interface UsdInr {
  /** ₹ per 1 USD. */
  rate: number;
  /** When the live rate was fetched (ISO), or null while on the fallback. */
  fetchedAt: string | null;
  source: "live" | "fallback";
}

/** Reads `rates.INR` (frankfurter.dev and open.er-api.com both use it). Out of 50..200 is treated as garbage. */
export function parseUsdInr(json: unknown): number | null {
  const rate = (json as { rates?: { INR?: unknown } } | null)?.rates?.INR;
  return typeof rate === "number" && Number.isFinite(rate) && rate >= 50 && rate <= 200 ? rate : null;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new InternalFailure(`http_${res.status}`);
  return res.json();
}

export interface UsdInrCacheOptions {
  url: string;
  fetchJson?: (url: string) => Promise<unknown>;
  now?: () => number;
  log?: Log;
}

/**
 * `get()` answers at once from memory and, when the cached rate is a day old, refreshes in the background.
 * Until the first fetch succeeds, and whenever fetches keep failing, it answers with the fallback (or the last live rate).
 */
export function usdInrCache({ url, fetchJson: load = fetchJson, now = Date.now, log = () => {} }: UsdInrCacheOptions) {
  let current: UsdInr = { rate: USD_INR_FALLBACK, fetchedAt: null, source: "fallback" };
  let nextTryAt = 0;
  let inFlight: Promise<void> | null = null;

  const refresh = () =>
    (inFlight ??= load(url)
      .then((json) => {
        const rate = parseUsdInr(json);
        if (rate === null) throw new InternalFailure("no_usable_rate");
        current = { rate, fetchedAt: new Date(now()).toISOString(), source: "live" };
        nextTryAt = now() + USD_INR_REFRESH_MS;
      })
      .catch((e: unknown) => {
        nextTryAt = now() + USD_INR_RETRY_MS;
        // Only our own reasons are logged: a network error message can carry the source URL.
        log("fx.usd_inr_failed", { reason: e instanceof InternalFailure ? e.reason : "fetch_failed", keeping: current.rate });
      })
      .finally(() => {
        inFlight = null;
      }));

  return {
    get(): UsdInr {
      if (now() >= nextTryAt) void refresh();
      return current;
    },
    /** For tests and startup: wait for a refresh in progress. */
    settled: () => inFlight ?? Promise.resolve(),
  };
}

/** GET /fx/usd-inr → { ok, usdInr, fetchedAt, source }. Public, no sign-in; the answer is one cached number. */
export function usdInrRoutes({ cache, origins }: { cache: ReturnType<typeof usdInrCache>; origins: ReadonlySet<string> }): Routes {
  return corsRoute("GET", USD_INR_PATH, origins, (_req, res) => {
    const { rate, fetchedAt, source } = cache.get();
    sendJson(res, 200, { ok: true, usdInr: rate, fetchedAt, source });
  });
}
