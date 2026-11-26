/**
 * Owner-only reads for /me, /season and /challenge, from the worker (apps/worker/src/{owner,daily-call,big-moves,
 * challenges}/route.ts). Shapes are copied, not shared: packages/shared is frozen. Every parser rejects an
 * off-shape answer as a whole, so nothing half-checked reaches a signature.
 */
import { ASSETS, type AssetId, type SignedApprovedOrder, type SignedDailyCallBotView } from "@botfolio/shared";
import type { Hex } from "viem";
import { FlowError } from "./errors";
import type { WalletSession } from "./wallet";
import { postJson } from "./worker";

export const OWNER_PATH = "/owner";
export const DAILY_CALL_PATH = "/daily-call";
export const DAILY_CALL_VIEW_PATH = "/daily-call/view";
export const BIG_MOVES_PATH = "/big-moves";
export const BIG_MOVES_SHRINK_PATH = "/big-moves/shrink";
export const CHALLENGE_PATH = "/challenge";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isHex = (v: unknown, bytes?: number): v is Hex =>
  typeof v === "string" && (bytes ? new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`) : /^0x([0-9a-fA-F]{2})+$/).test(v);
const isTx = (v: unknown): v is Hex => isHex(v, 32);
const BOT_ID = /^[1-9]\d{0,19}$/;
const isBotId = (v: unknown): v is string => typeof v === "string" && BOT_ID.test(v);
const isInt = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const nullOr = <T>(v: unknown, ok: (x: unknown) => x is T): v is T | null => v === null || ok(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isStr = (v: unknown): v is string => typeof v === "string";

// ---------------------------------------------------------------------------
// POST /owner
// ---------------------------------------------------------------------------

/** The v2 proposal's config, as `commitVersion` commits its hash (apps/worker/src/v2/propose.ts V2Config). */
export interface V2Config {
  version: number;
  season: number;
  rules: string;
  max_per_coin_bps: number;
  max_trades_per_day: number;
  from: { version: number; rules: string; max_per_coin_bps: number; max_trades_per_day: number };
  changes: { what: string; because_correction_id: number }[];
  approve_by: string;
}

export interface OwnerTodayCall {
  userUp: boolean;
  botUp: boolean;
  callTx: Hex;
  settleTx: Hex | null;
  userCorrect: boolean | null;
  botCorrect: boolean | null;
}

export interface OwnerBot {
  botId: string;
  name: string;
  status: string;
  proposal: { version: number; configHash: Hex; config: V2Config; approveBy: string } | null;
  calls: { season: number | null; you: number; bot: number; streak: number; today: OwnerTodayCall | null };
}

// Same bounds as BotRegistry's shared check (SPEC §4.2): a proposal outside them can't be approved.
const inLimits = (coin: unknown, trades: unknown) => isInt(coin, 1000, 5000) && isInt(trades, 1, 8);

function parseConfig(c: unknown, version: number): V2Config | null {
  if (!isObj(c) || c.version !== version || !isInt(c.season, 0, 1e6) || !isStr(c.rules) || !inLimits(c.max_per_coin_bps, c.max_trades_per_day)) return null;
  if (!isStr(c.approve_by) || Number.isNaN(Date.parse(c.approve_by))) return null;
  const f = c.from;
  if (!isObj(f) || !isInt(f.version, 1, version - 1) || !isStr(f.rules) || !inLimits(f.max_per_coin_bps, f.max_trades_per_day)) return null;
  if (!Array.isArray(c.changes) || !c.changes.every((x) => isObj(x) && isStr(x.what) && Number.isSafeInteger(x.because_correction_id))) return null;
  return {
    version,
    season: c.season,
    rules: c.rules,
    max_per_coin_bps: c.max_per_coin_bps as number,
    max_trades_per_day: c.max_trades_per_day as number,
    from: { version: f.version, rules: f.rules, max_per_coin_bps: f.max_per_coin_bps as number, max_trades_per_day: f.max_trades_per_day as number },
    changes: (c.changes as { what: string; because_correction_id: number }[]).map((x) => ({ what: x.what, because_correction_id: x.because_correction_id })),
    approve_by: c.approve_by,
  };
}

export function parseOwner(json: unknown): OwnerBot[] | null {
  if (!isObj(json) || json.ok !== true || !Array.isArray(json.bots)) return null;
  const out: OwnerBot[] = [];
  for (const b of json.bots) {
    if (!isObj(b) || !isBotId(b.botId) || !isStr(b.name) || !isStr(b.status) || !isObj(b.calls)) return null;
    const c = b.calls;
    if (!nullOr(c.season, (x): x is number => isInt(x, 0, 1e6)) || ![c.you, c.bot, c.streak].every((n) => isInt(n, 0, 1e6))) return null;
    let today: OwnerTodayCall | null = null;
    if (c.today !== null) {
      const t = c.today;
      if (!isObj(t) || !isBool(t.userUp) || !isBool(t.botUp) || !isTx(t.callTx) || !nullOr(t.settleTx, isTx) || !nullOr(t.userCorrect, isBool) || !nullOr(t.botCorrect, isBool)) return null;
      today = { userUp: t.userUp, botUp: t.botUp, callTx: t.callTx, settleTx: t.settleTx, userCorrect: t.userCorrect, botCorrect: t.botCorrect };
    }
    let proposal: OwnerBot["proposal"] = null;
    if (b.proposal !== null) {
      const p = b.proposal;
      if (!isObj(p) || !isInt(p.version, 2, 1e6) || !isHex(p.configHash, 32) || !isStr(p.approveBy)) return null;
      const config = parseConfig(p.config, p.version);
      if (!config) return null;
      proposal = { version: p.version, configHash: p.configHash, config, approveBy: p.approveBy };
    }
    out.push({
      botId: b.botId,
      name: b.name,
      status: b.status,
      proposal,
      calls: { season: c.season, you: c.you as number, bot: c.bot as number, streak: c.streak as number, today },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// POST /daily-call, /daily-call/view
// ---------------------------------------------------------------------------

export type DailyCallState = "waiting" | "open" | "called" | "closed" | "joins_tomorrow";
const CALL_STATES: readonly DailyCallState[] = ["waiting", "open", "called", "closed", "joins_tomorrow"];

export interface DailyCallToday {
  day: number;
  closesAt: string;
  bots: { botId: string; botName: string; state: DailyCallState }[];
}

export function parseDailyCall(json: unknown): DailyCallToday | null {
  if (!isObj(json) || json.ok !== true || !isInt(json.day, 0, 1e7) || !isStr(json.closesAt) || !Array.isArray(json.bots)) return null;
  const bots: DailyCallToday["bots"] = [];
  for (const b of json.bots) {
    if (!isObj(b) || !isBotId(b.botId) || !isStr(b.botName) || !CALL_STATES.includes(b.state as DailyCallState)) return null;
    bots.push({ botId: b.botId, botName: b.botName, state: b.state as DailyCallState });
  }
  return { day: json.day, closesAt: json.closesAt, bots };
}

export function parseDailyView(json: unknown): SignedDailyCallBotView | null {
  const v = isObj(json) && json.ok === true ? json.view : null;
  if (!isObj(v) || !isBotId(v.botId) || !isInt(v.day, 0, 1e7) || !isBool(v.botUp) || !isHex(v.botSig)) return null;
  return { botId: v.botId, day: v.day, botUp: v.botUp, botSig: v.botSig };
}

// ---------------------------------------------------------------------------
// POST /big-moves
// ---------------------------------------------------------------------------

export interface PendingBigMove {
  orderId: Hex;
  botId: string;
  botName: string;
  asset: AssetId;
  side: "BUY" | "SELL";
  bps: number;
  deadline: string;
  reason: string | null;
  signed: SignedApprovedOrder;
}

export function parseBigMoves(json: unknown): PendingBigMove[] | null {
  if (!isObj(json) || json.ok !== true || !Array.isArray(json.bigMoves)) return null;
  const out: PendingBigMove[] = [];
  for (const m of json.bigMoves) {
    if (!isObj(m) || !isHex(m.orderId, 32) || !isBotId(m.botId) || !isStr(m.botName) || !isInt(m.bps, 1, 10_000)) return null;
    const asset = ASSETS.find((a) => a.id === m.asset);
    if (!asset || (m.side !== "BUY" && m.side !== "SELL") || !isStr(m.deadline) || !nullOr(m.reason, isStr)) return null;
    const s = m.signed;
    const o = isObj(s) ? s.order : null;
    // The order the owner signs must be the one this prompt describes.
    if (!isObj(s) || !isHex(s.runnerSig) || !isObj(o) || o.botId !== m.botId || o.asset !== asset.index || o.buy !== (m.side === "BUY") || o.bps !== m.bps) return null;
    if (!isHex(o.decisionId, 32) || !isInt(o.actionIndex, 0, 2) || !isStr(o.deadline) || !/^\d{1,20}$/.test(o.deadline)) return null;
    out.push({
      orderId: m.orderId,
      botId: m.botId,
      botName: m.botName,
      asset: asset.id,
      side: m.side,
      bps: m.bps,
      deadline: m.deadline,
      reason: m.reason,
      signed: {
        order: { botId: o.botId, asset: o.asset, buy: o.buy, bps: o.bps, decisionId: o.decisionId, actionIndex: o.actionIndex, deadline: o.deadline },
        runnerSig: s.runnerSig,
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// GET /challenge
// ---------------------------------------------------------------------------

export interface ChallengeSide {
  botId: string;
  name: string;
  emoji: string;
  ownerWallet: string;
}
export interface PublicChallenge {
  code: Hex;
  season: number;
  status: "open" | "accepted" | "settled" | "expired";
  challenger: ChallengeSide;
  opponent: ChallengeSide | null;
  createTx: string | null;
  acceptTx: string | null;
  winnerBotId: string | null;
}

const isSide = (s: unknown): s is ChallengeSide =>
  isObj(s) && isBotId(s.botId) && isStr(s.name) && isStr(s.emoji) && isStr(s.ownerWallet) && /^0x[0-9a-f]{40}$/.test(s.ownerWallet);

export function parseChallenge(json: unknown): PublicChallenge | null {
  const c = isObj(json) && json.ok === true ? json.challenge : null;
  if (!isObj(c) || !isHex(c.code, 32) || !isInt(c.season, 0, 1e6) || !["open", "accepted", "settled", "expired"].includes(c.status as string)) return null;
  if (!isSide(c.challenger) || !nullOr(c.opponent, isSide) || !nullOr(c.createTx, isStr) || !nullOr(c.acceptTx, isStr) || !nullOr(c.winnerBotId, isBotId)) return null;
  return {
    code: c.code,
    season: c.season,
    status: c.status as PublicChallenge["status"],
    challenger: c.challenger,
    opponent: c.opponent,
    createTx: c.createTx,
    acceptTx: c.acceptTx,
    winnerBotId: c.winnerBotId,
  };
}

/** Share links carry the first 8 bytes of the code (SPEC §2.5). */
export const shortCode = (code: Hex) => code.slice(2, 18).toLowerCase();
export const SHORT_CODE = /^[0-9a-f]{16}$/;

export type ChallengeResult = { kind: "ok"; challenge: PublicChallenge } | { kind: "not_found" } | { kind: "not_live" } | { kind: "error" };

/** Public read; works logged out, so it can run on the server. */
export async function fetchChallenge(short: string, base: string | null, fetchImpl: typeof fetch = fetch): Promise<ChallengeResult> {
  if (!SHORT_CODE.test(short)) return { kind: "not_found" };
  if (!base) return { kind: "not_live" };
  try {
    const res = await fetchImpl(`${base}${CHALLENGE_PATH}?code=${short}`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
    if (res.status === 404) return { kind: "not_found" };
    if (res.status === 503) return { kind: "not_live" };
    if (!res.ok) return { kind: "error" };
    const challenge = parseChallenge(await res.json());
    return challenge ? { kind: "ok", challenge } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

// ---------------------------------------------------------------------------
// Signed-in POSTs
// ---------------------------------------------------------------------------

type Auth = Pick<WalletSession, "authKind" | "getAuthToken">;

async function ownerPost<T>(workerUrl: string, auth: Auth, path: string, body: unknown, parse: (json: unknown) => T | null): Promise<T> {
  const noAnswer = "Your bot's data didn't come back. Please try again.";
  const parsed = parse(await postJson({ url: workerUrl + path, auth, body, timeoutMs: 15_000, noAnswer }));
  if (parsed === null) throw new FlowError("BAD_RESPONSE", noAnswer);
  return parsed;
}

export const fetchOwner = (w: string, a: Auth) => ownerPost(w, a, OWNER_PATH, {}, parseOwner);
export const fetchDailyCall = (w: string, a: Auth) => ownerPost(w, a, DAILY_CALL_PATH, {}, parseDailyCall);
/** Only ask after the owner has picked: the answer holds the bot's view (SPEC §2.2). */
export const fetchDailyView = (w: string, a: Auth, botId: string) => ownerPost(w, a, DAILY_CALL_VIEW_PATH, { botId }, parseDailyView);
export const fetchBigMoves = (w: string, a: Auth) => ownerPost(w, a, BIG_MOVES_PATH, {}, parseBigMoves);
/** Shrink is no tx: the worker ends the 2 h window now and the runner sends the safe size (#80). */
export const shrinkBigMove = (w: string, a: Auth, orderId: Hex) =>
  ownerPost(w, a, BIG_MOVES_SHRINK_PATH, { orderId }, (j) => (isObj(j) && isStr(j.note) ? j.note : null));

// ---------------------------------------------------------------------------
// Slot clock (SPEC §6.1: 09:00, 13:00, 17:00, 21:00 IST)
// ---------------------------------------------------------------------------

const IST_MS = 19_800_000;
const SLOT_HOURS = [9, 13, 17, 21];

/** The next scheduled slot strictly after `nowMs`. */
export function nextSlot(nowMs: number): Date {
  const day = Math.floor((nowMs + IST_MS) / 86_400_000);
  for (let d = day; ; d++) {
    for (const h of SLOT_HOURS) {
      const t = d * 86_400_000 - IST_MS + h * 3_600_000;
      if (t > nowMs) return new Date(t);
    }
  }
}

/** "2h 14m", "9m", "<1m". */
export function countdown(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "<1m";
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
