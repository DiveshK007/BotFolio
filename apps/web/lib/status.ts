import { ASSETS, type AssetId } from "@botfolio/shared";
import { getWorkerUrl } from "./config";

/** Worker route with the public part of /healthz (apps/worker/src/status/route.ts). */
export const STATUS_PATH = "/status";

export interface SiteStatus {
  staleFeeds: AssetId[];
  resting: boolean;
}

const LABELS = new Map<string, string>(ASSETS.map((a) => [a.id, a.label]));

/** The worker's status, or null on any failure: the banner then shows nothing. */
export async function fetchStatus(workerUrl: string, fetchImpl: typeof fetch = fetch): Promise<SiteStatus | null> {
  try {
    const res = await fetchImpl(workerUrl + STATUS_PATH, { credentials: "omit" });
    const json = (await res.json()) as { ok?: unknown; staleFeeds?: unknown; resting?: unknown } | null;
    if (!res.ok || json?.ok !== true || !Array.isArray(json.staleFeeds) || typeof json.resting !== "boolean") return null;
    // Unknown ids are dropped, so nothing the worker sends is shown as-is.
    return { staleFeeds: json.staleFeeds.filter((id): id is AssetId => LABELS.has(id)), resting: json.resting };
  } catch {
    return null;
  }
}

export function loadStatus(): Promise<SiteStatus | null> {
  const base = getWorkerUrl();
  return base ? fetchStatus(base) : Promise.resolve(null);
}

/** Plain lines for the banner; empty = all clear. */
export function statusMessages(status: SiteStatus | null): string[] {
  if (!status) return [];
  const lines: string[] = [];
  const names = status.staleFeeds.map((id) => LABELS.get(id)!);
  if (names.length === 1) {
    lines.push(`${names[0]} prices are delayed — bots hold ${names[0] === "Gold" ? "gold" : names[0]} until the oracle updates.`);
  } else if (names.length > 1) {
    const list = `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    lines.push(`${list} prices are delayed — bots hold them until the oracle updates.`);
  }
  if (status.resting) lines.push("Bots are resting — they'll hold until the AI is back.");
  return lines;
}
