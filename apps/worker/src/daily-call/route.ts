import { istDay, type SignedDailyCallBotView } from "@botfolio/shared";
import type { Hex } from "viem";
import { authedRoute } from "../auth/middleware";
import type { Log } from "../auth/log";
import type { Authenticator } from "../auth/types";
import { callsCloseAt } from "../decisions/secrecy";
import type { Queryable } from "../scheduler/db";
import type { Routes } from "../server";

export const DAILY_CALL_PATH = "/daily-call";
export const DAILY_CALL_VIEW_PATH = "/daily-call/view";

const NINE_BEFORE_CUTOFF_S = 11 * 3_600; // the 09:00 slot, which signs the day's views, is 11 h before 20:00

/**
 * - `waiting`: no view yet, but the bot's 09:00 (or debut) decision hasn't run, so one may still come.
 * - `open`: a signed view exists and it's before 20:00 IST. The owner can pick.
 * - `called`: the owner's call is indexed; results are in `site_daily_calls`.
 * - `closed`: a view exists but it's 20:00 IST or later.
 * - `joins_tomorrow`: the bot decided today without a view (SPEC §6.4.1: "Your bot joins tomorrow's call").
 */
export type DailyCallState = "waiting" | "open" | "called" | "closed" | "joins_tomorrow";

export interface DailyCallBot {
  botId: string;
  botName: string;
  state: DailyCallState;
}

export interface DailyCallRouteOptions {
  origins: ReadonlySet<string>;
  auth: Authenticator;
  log: Log;
  /** null = no DATABASE_URL: every call gets 503. */
  db: Queryable | null;
  now?: () => Date;
}

const refusal = (status: number, code: string, message: string) => ({ status, body: { ok: false, error: { code, message } } });

interface Row {
  bot_id: string;
  name: string;
  has_view: boolean;
  called: boolean;
  decided: boolean;
}

/** The IST day, its 09:00 and its 20:00 cutoff, all from one clock reading. */
function today(now: Date) {
  const seconds = Math.floor(now.getTime() / 1000);
  const cutoff = callsCloseAt(now).getTime() / 1000; // DailyCall.call reverts from 20:00 IST (SPEC §4.7)
  return { day: istDay(seconds), seconds, nine: cutoff - NINE_BEFORE_CUTOFF_S, cutoff };
}

function stateOf(row: Row, t: ReturnType<typeof today>): DailyCallState {
  if (row.called) return "called";
  if (row.has_view) return t.seconds < t.cutoff ? "open" : "closed";
  // Views come only from the 09:00 slot or the debut, so once the bot has decided since 09:00, none is coming.
  return t.seconds >= t.nine && row.decided ? "joins_tomorrow" : "waiting";
}

/**
 * The owner's side of Daily Call (SPEC §2.2, §6.4.1, #190). Signed in:
 *  - POST /daily-call `{}` → `{ ok, day, closesAt, bots: DailyCallBot[] }`: today's state for each of the owner's
 *    active bots. No bot view in here.
 *  - POST /daily-call/view `{ botId }` → `{ ok, view: SignedDailyCallBotView }`, only while `open`. The app asks
 *    after the user picks, reveals `botUp`, and relays `DailyCall.call(botId, userUp, botUp, botSig)`.
 * `bot_up_sig` is never anon-readable, and the view is never logged (#254).
 */
export function dailyCallRoutes({ origins, auth, log, db, now = () => new Date() }: DailyCallRouteOptions): Routes {
  const rows = async (q: Queryable, wallets: readonly string[], t: ReturnType<typeof today>, botId: string | null) =>
    (
      await q.query<Row>(
        `select b.id::text as bot_id, b.name,
                (c.id is not null) as has_view,
                (c.user_wallet is not null) as called,
                exists (select 1 from decisions d join slots s on s.id = d.slot_id
                        where d.bot_id = b.id and s.slot_time >= to_timestamp($3::float8)) as decided
         from bots b left join daily_calls c on c.bot_id = b.id and c.day = $2::int
         where b.owner_wallet = any($1::text[]) and not b.is_house and b.status = 'active'
           and ($4::bigint is null or b.id = $4::bigint)
         order by b.id`,
        [wallets, t.day, t.nine, botId],
      )
    ).rows;

  return {
    ...authedRoute({
      path: DAILY_CALL_PATH,
      origins,
      auth,
      log,
      async handle({ identity }) {
        if (!db) return refusal(503, "DAILY_CALL_DISABLED", "Daily Call isn't switched on yet.");
        const t = today(now());
        const bots: DailyCallBot[] = (await rows(db, identity.wallets, t, null)).map((r) => ({
          botId: r.bot_id,
          botName: r.name,
          state: stateOf(r, t),
        }));
        return { status: 200, body: { ok: true, day: t.day, closesAt: new Date(t.cutoff * 1000).toISOString(), bots } };
      },
    }),
    ...authedRoute({
      path: DAILY_CALL_VIEW_PATH,
      origins,
      auth,
      log,
      async handle({ identity, body }) {
        if (!db) return refusal(503, "DAILY_CALL_DISABLED", "Daily Call isn't switched on yet.");
        const raw = (body as { botId?: unknown } | null)?.botId;
        const botId = typeof raw === "number" && Number.isSafeInteger(raw) ? String(raw) : raw;
        if (typeof botId !== "string" || !/^[1-9]\d{0,18}$/.test(botId)) {
          return refusal(400, "BAD_REQUEST", "Which bot? Send its botId.");
        }
        const t = today(now());
        const [row] = await rows(db, identity.wallets, t, botId);
        if (!row) return refusal(404, "NOT_FOUND", "That isn't one of your active bots.");
        const state = stateOf(row, t);
        if (state === "joins_tomorrow") return refusal(409, "JOINS_TOMORROW", "Your bot joins tomorrow's call.");
        if (state === "waiting") return refusal(409, "NOT_YET", "Your bot makes its call at 09:00.");
        if (state === "called") return refusal(409, "ALREADY_CALLED", "You already made today's call.");
        if (state === "closed") return refusal(409, "CLOSED", "Today's call closed at 20:00. Back tomorrow.");

        const { rows: view } = await db.query<{ bot_up: boolean; sig: Hex }>(
          `select bot_up, '0x' || encode(bot_up_sig, 'hex') as sig from daily_calls where bot_id = $1::bigint and day = $2::int`,
          [botId, t.day],
        );
        const signed: SignedDailyCallBotView = { botId, day: t.day, botUp: view[0]!.bot_up, botSig: view[0]!.sig };
        return { status: 200, body: { ok: true, view: signed } };
      },
    }),
  };
}
