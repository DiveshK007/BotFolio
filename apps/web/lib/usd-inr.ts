import { workerBase } from "./config";

/** Worker route serving the daily-cached USD/INR rate (apps/worker/src/fx/usd-inr.ts). Display only. */
export const USD_INR_PATH = "/fx/usd-inr";

/** ₹ per 1 USD from the worker, or null on any failure: the tooltip then just leaves the rate out. */
export async function fetchUsdInr(workerUrl: string, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  try {
    const res = await fetchImpl(workerUrl + USD_INR_PATH, { credentials: "omit" });
    const json = (await res.json()) as { ok?: unknown; usdInr?: unknown } | null;
    return res.ok && json?.ok === true && typeof json.usdInr === "number" && json.usdInr > 0 ? json.usdInr : null;
  } catch {
    return null;
  }
}

let pending: Promise<number | null> | null = null;

/** One fetch per page load, shared by every ₹ figure on it. */
export function loadUsdInr(): Promise<number | null> {
  const base = workerBase(process.env.NEXT_PUBLIC_RELAY_URL);
  if (!base) return Promise.resolve(null);
  return (pending ??= fetchUsdInr(base));
}
