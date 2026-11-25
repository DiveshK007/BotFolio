/**
 * Server-side read of a bot's public page (S4, SPEC §2.4) from the worker's GET /bot-page.
 * Every string in it (name, persona, reasons, roasts) is LLM output from user text, so untrusted (#159):
 * render it as JSX text only, never as HTML, a link or metadata.
 */
import { ASSETS, type AssetId } from "@botfolio/shared";
import { workerBase } from "./config";
import { priceAge } from "./format";

export const BOT_ID = /^[1-9]\d{0,19}$/;
export const BOT_PAGE_PATH = "/bot-page";
const TIMEOUT_MS = 8_000;
/** The worker data changes once a slot; a minute old is fresh enough and keeps load off the worker. */
export const REVALIDATE_S = 60;

export interface BotVersion {
  version: number;
  source: string;
  config_hash: string;
  committed_tx: string | null;
  approved_at: string | null;
  max_per_coin_bps: number;
  max_trades_per_day: number;
}
export interface BotTrade {
  tx_hash: string;
  block_number: string;
  asset: AssetId;
  side: "BUY" | "SELL";
  cash_e8: string;
  units_e18: string;
  price_e8: string;
  round_id: string;
  reason: string | null;
  decision_id: string;
  slot_time: string;
  oracle_updated_at: string | null;
  owner_signed: boolean;
}
export interface BotDecision {
  id: string;
  version: number;
  slot_time: string;
  slot_kind: string;
  status: string;
  reason: string | null;
  reason_tag: string | null;
  roast: string | null;
}
export interface BotSeason {
  season: number;
  return_bps: number;
  max_dd_bps: number;
  sortino: number | null;
  trades: number;
  battle_rank: number | null;
}
export interface BotTrust {
  season: number;
  rulesVersion: string;
  fRules: number;
  fDrawdown: number;
  fConsistency: number;
  fExplains: number;
  total: number;
  provisional: boolean;
  root: string;
  committedRoot: string | null;
  scoresTx: string | null;
}
export interface BotMark {
  slot_time: string;
  cash_e8: string;
  value_e8: string;
  holdings: { asset: AssetId; units_e18: string; value_e8: string }[];
  prices: { asset: AssetId; round_id: string; answer_e8: string; updated_at: string; fresh: boolean }[];
}
export interface BotPage {
  bot: {
    id: string;
    name: string;
    emoji: string;
    persona: string;
    owner_wallet: string;
    owner_qie_name: string | null;
    is_house: boolean;
    status: string;
    created_at: string;
    created_tx: string | null;
  };
  versions: BotVersion[];
  trades: BotTrade[];
  seasons: BotSeason[];
  trust: BotTrust | null;
  start_cash_e8: string;
  mark: BotMark | null;
  decisions: BotDecision[];
}

export type BotPageResult = { kind: "ok"; page: BotPage } | { kind: "not_found" } | { kind: "not_live" } | { kind: "error" };

const UINT = /^\d{1,78}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isAsset = (a: unknown): a is AssetId => ASSETS.some((x) => x.id === a);

/**
 * Shape check on the worker's answer: the fields the page does maths or links with. A bad top level is an error;
 * a bad row is dropped rather than shown wrong.
 */
export function parseBotPage(json: unknown): BotPage | null {
  if (!isObj(json) || json.ok !== true || !isObj(json.page)) return null;
  const p = json.page;
  const bot = p.bot;
  if (!isObj(bot) || typeof bot.id !== "string" || !BOT_ID.test(bot.id) || typeof bot.name !== "string") return null;
  if (typeof p.start_cash_e8 !== "string" || !UINT.test(p.start_cash_e8) || BigInt(p.start_cash_e8) === 0n) return null;
  if (![p.versions, p.trades, p.seasons, p.decisions].every(Array.isArray)) return null;

  const trades = (p.trades as unknown[]).filter(
    (t): t is BotTrade =>
      isObj(t) && isAsset(t.asset) && (t.side === "BUY" || t.side === "SELL") &&
      [t.cash_e8, t.units_e18, t.price_e8, t.round_id].every((v) => typeof v === "string" && UINT.test(v)),
  );
  let mark: BotMark | null = null;
  if (isObj(p.mark) && typeof p.mark.value_e8 === "string" && UINT.test(p.mark.value_e8) && typeof p.mark.cash_e8 === "string" && UINT.test(p.mark.cash_e8)) {
    const m = p.mark as unknown as BotMark;
    mark = {
      ...m,
      holdings: (Array.isArray(m.holdings) ? m.holdings : []).filter((h) => isObj(h) && isAsset(h.asset) && UINT.test(String(h.value_e8)) && UINT.test(String(h.units_e18))),
      prices: (Array.isArray(m.prices) ? m.prices : []).filter((r) => isObj(r) && isAsset(r.asset) && UINT.test(String(r.answer_e8)) && !Number.isNaN(Date.parse(String(r.updated_at)))),
    };
  }
  return {
    bot: bot as unknown as BotPage["bot"],
    versions: (p.versions as unknown[]).filter((v): v is BotVersion => isObj(v) && typeof v.version === "number"),
    trades,
    seasons: (p.seasons as unknown[]).filter((s): s is BotSeason => isObj(s) && typeof s.season === "number" && typeof s.return_bps === "number"),
    trust: isObj(p.trust) && typeof p.trust.total === "number" ? (p.trust as unknown as BotTrust) : null,
    start_cash_e8: p.start_cash_e8,
    mark,
    decisions: (p.decisions as unknown[]).filter((d): d is BotDecision => isObj(d) && typeof d.id === "string" && typeof d.status === "string"),
  };
}

/** No worker URL or the worker says 503 → "not live yet"; 404 → not found; anything else that fails → error. */
export async function fetchBotPage(
  botId: string,
  base: string | null = workerBase(process.env.NEXT_PUBLIC_RELAY_URL),
  fetchImpl: typeof fetch = fetch,
): Promise<BotPageResult> {
  if (!BOT_ID.test(botId)) return { kind: "not_found" };
  if (!base) return { kind: "not_live" };
  try {
    const res = await fetchImpl(`${base}${BOT_PAGE_PATH}?bot=${botId}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: REVALIDATE_S },
    } as RequestInit);
    if (res.status === 404) return { kind: "not_found" };
    if (res.status === 503) return { kind: "not_live" };
    if (!res.ok) return { kind: "error" };
    const page = parseBotPage(await res.json());
    return page ? { kind: "ok", page } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

const CALL_LABEL: Record<string, string> = {
  executed: "Traded",
  held: "Held",
  skipped_stale: "Held · price too old",
  invalid: "Held · no valid answer",
};
export const callLabel = (status: string) => CALL_LABEL[status] ?? "Held";

const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
/** "26 Nov, 09:00 IST". */
export const istTime = (iso: string) => (Number.isNaN(Date.parse(iso)) ? "—" : `${IST.format(new Date(iso))} IST`);

/** Basis points → "+10.00%" / "−2.50%". */
export function bpsPct(bps: number, signed = true): string {
  const text = `${(Math.abs(bps) / 100).toFixed(2)}%`;
  if (bps < 0) return `−${text}`;
  return signed && bps > 0 ? `+${text}` : text;
}

/** 18-decimal units → at most 6 decimals, trailing zeros cut: 1500000000000000000 → "1.5". */
export function formatUnits(e18: string): string {
  const v = BigInt(e18);
  const whole = v / 10n ** 18n;
  const frac = ((v % 10n ** 18n) / 10n ** 12n).toString().padStart(6, "0").replace(/0+$/, "");
  if (whole === 0n && !frac) return v === 0n ? "0" : "<0.000001";
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Share of the mark, whole percent. */
export const weightPct = (valueE8: string, totalE8: string) =>
  BigInt(totalE8) === 0n ? 0 : Number((BigInt(valueE8) * 100n + BigInt(totalE8) / 2n) / BigInt(totalE8));

/**
 * SPEC §5.7 age for a past trade: how old the oracle round was at the call, not now (now would call every old
 * trade "too old"). Null when the slot's read didn't see that round, so the age isn't known.
 */
export function ageAtCall(t: Pick<BotTrade, "asset" | "oracle_updated_at" | "slot_time">): string | null {
  if (!t.oracle_updated_at) return null;
  const updated = Date.parse(t.oracle_updated_at);
  const slot = Date.parse(t.slot_time);
  if (Number.isNaN(updated) || Number.isNaN(slot)) return null;
  return `${priceAge(t.asset, Math.floor(updated / 1000), slot).text} at the call`;
}
