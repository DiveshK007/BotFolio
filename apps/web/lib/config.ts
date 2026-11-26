import { QIE_RPC_URLS, qieMainnet, type RelayTargetContract } from "@botfolio/shared";
import type { Chain } from "viem";
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

/** The Render service origin alone, for public reads that need no contract address (leaderboards). null = not set. */
export const getWorkerUrl = () => workerBase(process.env.NEXT_PUBLIC_RELAY_URL);

// Each var is named in full: Next only inlines literal process.env.NEXT_PUBLIC_* reads into the browser bundle.
export const getCreateConfig = () =>
  parseCreateConfig({
    relayUrl: process.env.NEXT_PUBLIC_RELAY_URL,
    forwarder: process.env.NEXT_PUBLIC_FORWARDER_ADDRESS,
    registry: process.env.NEXT_PUBLIC_BOT_REGISTRY_ADDRESS,
  });

/** The signed-in owner screens: worker + forwarder, and each relay target that is deployed. */
export interface OwnerConfig {
  workerUrl: string;
  forwarder: `0x${string}`;
  /** A missing target means that one action isn't live yet; the screen says so instead of guessing an address. */
  targets: Partial<Record<RelayTargetContract, `0x${string}`>>;
}

export function parseOwnerConfig(env: { relayUrl?: string; forwarder?: string } & Partial<Record<RelayTargetContract, string>>): OwnerConfig | null {
  const workerUrl = workerBase(env.relayUrl);
  if (!workerUrl || !env.forwarder || !isAddress(env.forwarder)) return null;
  const targets: OwnerConfig["targets"] = {};
  for (const name of ["BotRegistry", "SeasonLedger", "PaperLedger", "DailyCall", "Challenges"] as const) {
    const a = env[name];
    if (a && isAddress(a)) targets[name] = a;
  }
  return { workerUrl, forwarder: env.forwarder, targets };
}

export const getOwnerConfig = () =>
  parseOwnerConfig({
    relayUrl: process.env.NEXT_PUBLIC_RELAY_URL,
    forwarder: process.env.NEXT_PUBLIC_FORWARDER_ADDRESS,
    BotRegistry: process.env.NEXT_PUBLIC_BOT_REGISTRY_ADDRESS,
    SeasonLedger: process.env.NEXT_PUBLIC_SEASON_LEDGER_ADDRESS,
    PaperLedger: process.env.NEXT_PUBLIC_PAPER_LEDGER_ADDRESS,
    DailyCall: process.env.NEXT_PUBLIC_DAILY_CALL_ADDRESS,
    Challenges: process.env.NEXT_PUBLIC_CHALLENGES_ADDRESS,
  });
/** rpc3 → 4 → 5 → 1 → 2, like the worker: rpc1/rpc2 drop TLS sometimes. */
export const DEFAULT_RPC_URLS: readonly string[] = [...QIE_RPC_URLS.slice(2), ...QIE_RPC_URLS.slice(0, 2)];

/**
 * NEXT_PUBLIC_QIE_RPC_URLS (#219): comma-separated, tried in order. https only, http just for a local fork.
 * Bad entries are dropped; nothing usable left → the 5 mainnet RPCs.
 */
export function parseRpcUrls(raw: string | undefined): string[] {
  const urls = (raw ?? "").split(",").map((u) => u.trim()).filter((u) => {
    try {
      const url = new URL(u);
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      return url.protocol === "https:" || (local && url.protocol === "http:");
    } catch {
      return false;
    }
  });
  return urls.length ? urls : [...DEFAULT_RPC_URLS];
}

export const getRpcUrls = () => parseRpcUrls(process.env.NEXT_PUBLIC_QIE_RPC_URLS);

/** QIE mainnet with the browser's RPC order. Privy and wallet_addEthereumChain both take this. */
export const getQieChain = (): Chain => ({ ...qieMainnet, rpcUrls: { default: { http: getRpcUrls() } } });

/** Public Privy app id (not a secret). null = passkey sign-in is off. */
export const getPrivyAppId = () => process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || null;
