import { isAddress } from "./format";

export interface CreateConfig {
  /** Origin of the Render service, no trailing slash. */
  workerUrl: string;
  forwarder: `0x${string}`;
  registry: `0x${string}`;
}

interface PublicEnv {
  relayUrl?: string;
  forwarder?: string;
  registry?: string;
}

/**
 * NEXT_PUBLIC_RELAY_URL (SPEC §10) reads as either the Render service URL or the full /relay URL, so accept both.
 * Plain http only for local dev, because we send a bearer token to it.
 */
export function workerBase(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    return (url.origin + url.pathname).replace(/\/+$/, "").replace(/\/relay$/, "");
  } catch {
    return null;
  }
}

/** null = bot creation isn't live (not deployed or env missing). Callers say so; there are no fallback addresses. */
export function parseCreateConfig(env: PublicEnv): CreateConfig | null {
  const workerUrl = workerBase(env.relayUrl);
  const { forwarder, registry } = env;
  if (!workerUrl || !forwarder || !registry || !isAddress(forwarder) || !isAddress(registry)) return null;
  return { workerUrl, forwarder, registry };
}

// Each var is named in full: Next only inlines literal process.env.NEXT_PUBLIC_* reads into the browser bundle.
export const getCreateConfig = () =>
  parseCreateConfig({
    relayUrl: process.env.NEXT_PUBLIC_RELAY_URL,
    forwarder: process.env.NEXT_PUBLIC_FORWARDER_ADDRESS,
    registry: process.env.NEXT_PUBLIC_BOT_REGISTRY_ADDRESS,
  });
