/**
 * Bot Dex list: reads the worker's public `GET /bots` (apps/worker/src/bots/route.ts).
 * The shape mirrors apps/worker's PublicBot; packages/shared is frozen, so it's copied, not shared.
 */
export const BOTS_PATH = "/bots";

export interface PublicBot {
  botId: string;
  name: string;
  emoji: string;
  isHouse: boolean;
  version: number;
  createdAt: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** null = off-shape answer; one bad entry rejects the lot, so nothing half-checked renders. */
export function parseBots(json: unknown): PublicBot[] | null {
  if (!isObj(json) || json.ok !== true || !Array.isArray(json.bots)) return null;
  const out: PublicBot[] = [];
  for (const b of json.bots) {
    if (!isObj(b) || typeof b.botId !== "string" || !/^[1-9]\d{0,19}$/.test(b.botId) || typeof b.name !== "string" || typeof b.emoji !== "string"
      || typeof b.isHouse !== "boolean" || !Number.isSafeInteger(b.version) || (b.version as number) < 1 || typeof b.createdAt !== "string") return null;
    out.push({ botId: b.botId, name: b.name, emoji: b.emoji, isHouse: b.isHouse, version: b.version as number, createdAt: b.createdAt });
  }
  return out;
}

/** null when the worker has no /bots (older deploy), says 503, or fails: the caller falls back to the boards. */
export async function fetchBots(base: string, fetchImpl: typeof fetch = fetch): Promise<PublicBot[] | null> {
  try {
    const res = await fetchImpl(base + BOTS_PATH, { signal: AbortSignal.timeout(8000), next: { revalidate: 60 } } as RequestInit);
    if (!res.ok) return null;
    return parseBots(await res.json());
  } catch {
    return null;
  }
}
