import { istDay } from "@botfolio/shared";
import type { Hex } from "viem";
import { authedRoute } from "../auth/middleware";
import type { Log } from "../auth/log";
import type { Authenticator } from "../auth/types";
import type { Queryable } from "../scheduler/db";
import type { Routes } from "../server";

export const OWNER_PATH = "/owner";

/** Today's Daily Call once it's on-chain. `botUp` is only here after the owner's own call is indexed (SPEC §2.2). */
export interface OwnerTodayCall {
  userUp: boolean;
  botUp: boolean;
  priceAtCallE8: string | null;
  callTx: Hex;
  settleTx: Hex | null;
  /** null = not settled yet, or the price didn't move. */
  userCorrect: boolean | null;
  botCorrect: boolean | null;
}

export interface OwnerBot {
  botId: string;
  name: string;
  status: string;
  /** The v2 waiting for Approve (SPEC §2.3 step 3–4), until its approve_by; null when there is none. */
  proposal: { version: number; configHash: Hex; config: unknown; approveBy: string } | null;
  /** Coach vs Bot this season (settled calls each side got right) and the owner's current win streak. */
  calls: { season: number | null; you: number; bot: number; streak: number; today: OwnerTodayCall | null };
}

export interface OwnerRouteOptions {
  origins: ReadonlySet<string>;
  auth: Authenticator;
  log: Log;
  /** null = no DATABASE_URL: every call gets 503. */
  db: Queryable | null;
  now?: () => Date;
}

const refusal = (status: number, code: string, message: string) => ({ status, body: { ok: false, error: { code, message } } });

/**
 * POST /owner `{}` → `{ ok, bots: OwnerBot[] }`: the owner-only reads /me and /season need that the public
 * bot page doesn't have (#77, #81, #83). Signed in; only the caller's own raised bots. Nothing secret: no runner
 * signatures, no correction notes, and the bot's Daily Call answer only once the owner's call is on-chain.
 */
export function ownerRoutes({ origins, auth, log, db, now = () => new Date() }: OwnerRouteOptions): Routes {
  return authedRoute({
    path: OWNER_PATH,
    origins,
    auth,
    log,
    async handle({ identity }) {
      if (!db) return refusal(503, "OWNER_DISABLED", "Your bot's page isn't switched on yet.");
      const at = now();
      const today = istDay(Math.floor(at.getTime() / 1000));
      const { rows: bots } = await db.query<{ id: string; name: string; status: string }>(
        `select id::text as id, name, status::text as status from bots
         where owner_wallet = any($1::text[]) and not is_house order by id`,
        [identity.wallets],
      );
      const { rows: seasons } = await db.query<{ id: number; starts_at: Date; ends_at: Date }>(
        `select id, starts_at, ends_at from seasons where id > 0 and starts_at <= $1::timestamptz order by id desc limit 1`,
        [at.toISOString()],
      );
      const season = seasons[0];
      const day = (t: Date) => istDay(Math.floor(new Date(t).getTime() / 1000));

      const out: OwnerBot[] = [];
      for (const b of bots) {
        const { rows: proposals } = await db.query<{ version: number; config_hash: Hex; config: unknown }>(
          `select p.version, '0x' || encode(p.config_hash, 'hex') as config_hash, p.config_json as config
           from bot_versions p
           where p.bot_id = $1::bigint and p.source = 'season_v2' and p.committed_tx is null
             and p.version = 1 + (select max(v.version) from bot_versions v
                                  where v.bot_id = p.bot_id and (v.committed_tx is not null or v.source = 'create'))`,
          [b.id],
        );
        const p = proposals[0];
        const config = typeof p?.config === "string" ? (JSON.parse(p.config) as unknown) : p?.config;
        const approveBy = (config as { approve_by?: unknown } | undefined)?.approve_by;
        const open = typeof approveBy === "string" && Date.parse(approveBy) > at.getTime();

        const { rows: calls } = await db.query<{
          day: number; user_up: boolean; bot_up: boolean; price: string | null; call_tx: Hex; settle_tx: Hex | null;
          user_correct: boolean | null; bot_correct: boolean | null;
        }>(
          `select day, user_up, bot_up, price_at_call_e8::text as price, call_tx, settle_tx, user_correct, bot_correct
           from daily_calls where bot_id = $1::bigint and call_tx is not null
           order by day desc`,
          [b.id],
        );
        const settled = season
          ? calls.filter((c) => c.settle_tx !== null && c.day >= day(season.starts_at) && c.day <= day(season.ends_at))
          : [];
        const streak = settled.findIndex((c) => c.user_correct !== true);
        const t = calls.find((c) => c.day === today);
        out.push({
          botId: b.id,
          name: b.name,
          status: b.status,
          proposal: p && open ? { version: p.version, configHash: p.config_hash, config, approveBy } : null,
          calls: {
            season: season?.id ?? null,
            you: settled.filter((c) => c.user_correct === true).length,
            bot: settled.filter((c) => c.bot_correct === true).length,
            streak: streak === -1 ? settled.length : streak,
            today: t
              ? { userUp: t.user_up, botUp: t.bot_up, priceAtCallE8: t.price, callTx: t.call_tx, settleTx: t.settle_tx, userCorrect: t.user_correct, botCorrect: t.bot_correct }
              : null,
          },
        });
      }
      return { status: 200, body: { ok: true, bots: out } };
    },
  });
}
