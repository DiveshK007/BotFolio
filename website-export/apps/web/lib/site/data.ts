/**
 * Server-side data loaders for the website. Every loader returns Loaded<T> with a status the
 * page MUST show (LIVE / EXAMPLE / not live yet / error). Rules (WEBSITE_BRIEF Phase 4):
 *  - fetch on the server with short revalidation (60 s);
 *  - on failure keep the section and show a fallback with a proof link;
 *  - NEVER fall back to made-up numbers in live mode.
 *
 * Switch: SITE_DATA_MODE = "example" (default until ~Nov 25) | "notlive" | "live".
 * Server-only env; never NEXT_PUBLIC_*.
 */
import "server-only";
import { ASSETS, type AssetId } from "@botfolio/shared";
import type { ActivityStats, BotRecord, CardPayload, ContractInfo, Leaderboards, Loaded, OracleRead, Trade } from "./types";
import { SAMPLE_BOARDS, SAMPLE_CARDS, SAMPLE_RECORD_12, SAMPLE_TRADES } from "./sample";

type Mode = "example" | "notlive" | "live";
export const SITE_MODE: Mode = (process.env.SITE_DATA_MODE as Mode) ?? "example";
const REVALIDATE = 60;
const now = () => new Date().toISOString();

function wrap<T>(data: T, source: string): Loaded<T> {
  return { status: "example", data, updatedAt: "2026-11-26T07:30:00Z", source };
}
const notLive = <T,>(source: string): Loaded<T> => ({ status: "notlive", data: null, updatedAt: null, source });
const failed = <T,>(source: string): Loaded<T> => ({ status: "error", data: null, updatedAt: now(), source });

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, next: { revalidate: REVALIDATE } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return (await r.json()) as T;
}

/** Supabase REST read with the anon key (RLS must allow public reads of indexed tables — UNVERIFIED, WS B). */
function supa<T>(pathAndQuery: string) {
  const base = process.env.SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) throw new Error("Supabase env missing");
  return getJSON<T>(`${base}/rest/v1/${pathAndQuery}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
}

/* ---------- contracts (env, filled after deploy ~Nov 22) ---------- */
export function getContracts(): ContractInfo[] {
  const a = (v?: string) => (v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as `0x${string}`) : null);
  return [
    { name: "BotForwarder", what: "Relays your signed requests so you never pay gas", address: a(process.env.FORWARDER_ADDRESS) },
    { name: "BotRegistry", what: "Bots, owners, persona hashes and limits", address: a(process.env.BOT_REGISTRY_ADDRESS) },
    { name: "PaperLedger", what: "Play balances and every trade, priced by the oracle", address: a(process.env.PAPER_LEDGER_ADDRESS) },
    { name: "SeasonLedger", what: "Coaching corrections, versions and season roots", address: a(process.env.SEASON_LEDGER_ADDRESS) },
    { name: "TrustScoreRegistry", what: "Trust rules and per-season score roots", address: a(process.env.TRUST_REGISTRY_ADDRESS) },
    { name: "DailyCall", what: "You vs your bot on BTC, settled by the oracle", address: a(process.env.DAILY_CALL_ADDRESS) },
    { name: "Challenges", what: "Bot vs bot challenge links, no stakes", address: a(process.env.CHALLENGES_ADDRESS) },
  ];
}

/* ---------- oracle prices: read straight from QIE (works today, no app needed) ---------- */
const RPCS = (process.env.QIE_RPC_URLS ?? "https://rpc3mainnet.qie.digital,https://rpc4mainnet.qie.digital,https://rpc5mainnet.qie.digital,https://rpc1mainnet.qie.digital,https://rpc2mainnet.qie.digital").split(",");
const LATEST_ROUND_DATA = "0xfeaf968c";
async function rpcCall(to: string, data: string): Promise<string> {
  let last: unknown;
  for (const url of RPCS) {
    try {
      const r = await getJSON<{ result?: string; error?: unknown }>(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
      });
      if (r.result) return r.result;
      last = r.error;
    } catch (e) { last = e; } // rpc1/rpc2 drop TLS sometimes: fail over
  }
  throw new Error("all QIE RPCs failed: " + String(last));
}
export async function getOraclePrices(): Promise<Loaded<OracleRead[]>> {
  try {
    const reads = await Promise.all(ASSETS.map(async a => {
      const hex = (await rpcCall(a.feed, LATEST_ROUND_DATA)).slice(2);
      const word = (i: number) => BigInt("0x" + hex.slice(i * 64, i * 64 + 64));
      return { asset: a.id as AssetId, roundId: word(0).toString(), answerE8: word(1).toString(), updatedAt: new Date(Number(word(3)) * 1000).toISOString() };
    }));
    return { status: "live", data: reads, updatedAt: now(), source: "https://mainnet.qie.digital" };
  } catch {
    return failed("https://mainnet.qie.digital");
  }
}

/* ---------- latest trades ---------- */
export async function getLatestTrades(): Promise<Loaded<Trade[]>> {
  if (SITE_MODE === "example") return wrap(SAMPLE_TRADES, "sample");
  if (SITE_MODE === "notlive") return notLive("https://mainnet.qie.digital");
  try {
    // Indexed `trades` joined to bots; view name agreed with WS B (UNVERIFIED until schema.sql freezes).
    const data = await supa<Trade[]>("site_latest_trades?select=*&order=block_time.desc&limit=5");
    return { status: "live", data, updatedAt: now(), source: "https://mainnet.qie.digital" };
  } catch { return failed("https://mainnet.qie.digital"); }
}

/* ---------- activity split (SPEC §11) ---------- */
export async function getActivity(): Promise<Loaded<ActivityStats>> {
  // No example numbers for traction, ever: show "counting starts at deploy" until live.
  if (SITE_MODE !== "live") return notLive("https://mainnet.qie.digital");
  try {
    const [row] = await supa<ActivityStats[]>("site_activity_stats?select=*");
    return { status: "live", data: row, updatedAt: now(), source: "https://mainnet.qie.digital" };
  } catch { return failed("https://mainnet.qie.digital"); }
}

/* ---------- leaderboards ---------- */
export async function getLeaderboards(season: number): Promise<Loaded<Leaderboards>> {
  if (SITE_MODE === "example") return wrap({ ...SAMPLE_BOARDS, season }, "sample");
  if (SITE_MODE === "notlive") return notLive("/proof");
  try {
    const data = await supa<Leaderboards>(`rpc/site_leaderboards?season=${season}`);
    return { status: "live", data, updatedAt: now(), source: "/proof" };
  } catch { return failed("/proof"); }
}

/* ---------- bot record: the public API (SPEC §10) ---------- */
export async function getBotRecord(botId: number): Promise<Loaded<BotRecord> & { notFound?: boolean }> {
  if (SITE_MODE === "example") return botId === 12 ? wrap(SAMPLE_RECORD_12, "sample") : { ...notLive<BotRecord>("sample"), notFound: true };
  if (SITE_MODE === "notlive") return notLive("https://mainnet.qie.digital");
  const base = process.env.APP_URL ?? "";
  try {
    const r = await fetch(`${base}/api/v1/bots/${botId}/record`, { next: { revalidate: REVALIDATE } });
    if (r.status === 404) return { ...failed<BotRecord>(""), notFound: true };
    if (!r.ok) throw new Error(String(r.status));
    return { status: "live", data: (await r.json()) as BotRecord, updatedAt: now(), source: `/api/v1/bots/${botId}/record` };
  } catch { return failed("https://mainnet.qie.digital"); }
}

/* ---------- share cards (WS D owns the payload; read from `cards`) ---------- */
export async function getCard(cardId: string): Promise<Loaded<CardPayload>> {
  if (SITE_MODE === "example") { const c = SAMPLE_CARDS[cardId] ?? SAMPLE_CARDS["example-roast"]; return wrap(c, "sample"); }
  if (SITE_MODE === "notlive") return notLive("/proof");
  try {
    const [c] = await supa<CardPayload[]>(`site_cards?id=eq.${encodeURIComponent(cardId)}&select=*`);
    if (!c) return failed("/proof");
    return { status: "live", data: c, updatedAt: now(), source: "/proof" };
  } catch { return failed("/proof"); }
}
