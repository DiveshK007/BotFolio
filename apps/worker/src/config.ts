import { ASSETS, QIE_RPC_URLS, type AssetId } from "@botfolio/shared";
import { loadLlmConfig, type LlmConfig } from "@botfolio/llm";

type Env = Record<string, string | undefined>;

export interface FeedConfig {
  asset: AssetId;
  address: `0x${string}`;
  maxAgeSeconds: number;
}

export interface BigMoveConfig {
  /** BUY whose post-trade weight in one asset is ≥ this → big move (SPEC §2.2, default 3000 = 30 %). */
  buyWeightBps: number;
  /** SELL of ≥ this share of a holding → big move (default 5000 = 50 %). */
  sellBps: number;
  /** How long the owner has to answer (default 120 min). */
  ttlMs: number;
}

export interface WorkerConfig {
  port: number;
  chainId: number;
  /** In failover order: rpc3 → rpc4 → rpc5 → rpc1 → rpc2 (rpc1/rpc2 drop TLS sometimes). */
  rpcUrls: string[];
  feeds: FeedConfig[];
  bigMove: BigMoveConfig;
  llm: LlmConfig;
  /** How often /healthz's oracle snapshot is refreshed. */
  oracleRefreshMs: number;
}

const QIE_CHAIN_ID = 1990;

export function loadWorkerConfig(env: Env = process.env): WorkerConfig {
  const chainId = intEnv(env, "QIE_CHAIN_ID", QIE_CHAIN_ID);
  // Staging on a local Anvil fork keeps chain id 1990 (docs/anvil-fork.md); anything else is a misconfiguration.
  if (chainId !== QIE_CHAIN_ID) throw new Error(`QIE_CHAIN_ID must be ${QIE_CHAIN_ID}, got ${chainId}`);

  const rawUrls = (env.QIE_RPC_URLS || QIE_RPC_URLS.join(","))
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  if (rawUrls.length === 0) throw new Error("QIE_RPC_URLS is empty");

  return {
    // Render injects PORT; 10000 is Render's default.
    port: intEnv(env, "PORT", 10000),
    chainId,
    rpcUrls: orderRpcUrls(rawUrls),
    feeds: ASSETS.map((a) => ({
      asset: a.id,
      address: (env[`FEED_${a.id}`] as `0x${string}` | undefined) || a.feed,
      maxAgeSeconds:
        a.id === "GOLD" ? intEnv(env, "MAX_AGE_GOLD_S", a.maxAgeSeconds) : intEnv(env, "MAX_AGE_CRYPTO_S", a.maxAgeSeconds),
    })),
    bigMove: loadBigMoveConfig(env),
    llm: loadLlmConfig(env),
    oracleRefreshMs: intEnv(env, "ORACLE_REFRESH_MS", 60_000),
  };
}

export function loadBigMoveConfig(env: Env = process.env): BigMoveConfig {
  const buyWeightBps = intEnv(env, "BIG_MOVE_BUY_WEIGHT_BPS", 3000);
  const sellBps = intEnv(env, "BIG_MOVE_SELL_BPS", 5000);
  if (buyWeightBps < 1 || buyWeightBps > 10000) throw new Error("BIG_MOVE_BUY_WEIGHT_BPS must be 1..10000");
  if (sellBps < 1 || sellBps > 10000) throw new Error("BIG_MOVE_SELL_BPS must be 1..10000");
  return { buyWeightBps, sellBps, ttlMs: intEnv(env, "BIG_MOVE_TTL_MIN", 120) * 60_000 };
}

/**
 * Failover order from issue #36: rpc3 → rpc4 → rpc5 → rpc1 → rpc2. rpc1 and rpc2 drop TLS sometimes,
 * so they go last. Other URLs (e.g. a local Anvil fork) keep their position at the front.
 */
export function orderRpcUrls(urls: string[]): string[] {
  const flaky = (u: string) => /\/\/rpc[12]mainnet\.qie\.digital/.test(u);
  const rank = (u: string) => {
    const m = /\/\/rpc(\d)mainnet\.qie\.digital/.exec(u);
    return m ? Number(m[1]) : 0;
  };
  const good = urls.filter((u) => !flaky(u)).sort((a, b) => rank(a) - rank(b));
  const bad = urls.filter(flaky).sort((a, b) => rank(a) - rank(b));
  return [...good, ...bad];
}

function intEnv(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return n;
}
