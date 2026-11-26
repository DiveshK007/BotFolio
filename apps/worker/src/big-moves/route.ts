import { decisionIdFromUuid, orderIdOf, type ApprovedOrderJson, type SignedApprovedOrder } from "@botfolio/shared";
import type { Hex } from "viem";
import { authedRoute } from "../auth/middleware";
import type { Log } from "../auth/log";
import type { Authenticator } from "../auth/types";
import { ASSET_IDS } from "../interfaces";
import type { Queryable } from "../scheduler/db";
import type { Routes } from "../server";

export const BIG_MOVES_PATH = "/big-moves";
export const BIG_MOVES_SHRINK_PATH = "/big-moves/shrink";

export interface BigMoveRouteOptions {
  origins: ReadonlySet<string>;
  auth: Authenticator;
  log: Log;
  /** null = no DATABASE_URL: every call gets 503. */
  db: Queryable | null;
}

export interface PendingBigMove {
  orderId: Hex;
  botId: string;
  botName: string;
  asset: string;
  side: "BUY" | "SELL";
  bps: number;
  /** After this the runner sends the safe-size order instead (SPEC §2.2). */
  deadline: string;
  /** The decision's reason, as logged. */
  reason: string | null;
  /** What the owner relays: `PaperLedger.executeApproved(order, runnerSig)` through the forwarder. */
  signed: SignedApprovedOrder;
}

/**
 * The big move `m`'s decision belongs to no season that has ended. After the end the season's replay root is
 * committed without it, so it must not trade any more (#355). The sweep expires it at its deadline.
 */
export const SEASON_OPEN = `not exists (
  select 1 from decisions sd join slots sl on sl.id = sd.slot_id join seasons se on se.id = sl.season_id
  where sd.id = m.decision_id and se.ends_at <= now())`;

const refusal = (status: number, code: string, message: string) => ({ status, body: { ok: false, error: { code, message } } });

/**
 * The owner's side of Approve Big Move (SPEC §2.2, #52). Signed in, the owner reads their pending big moves with
 * the runner's signature (never anon-readable), or asks for the safe size now.
 *  - POST /big-moves `{}` → `{ ok, bigMoves: PendingBigMove[] }`.
 *  - POST /big-moves/shrink `{ orderId }` → the 2 h window ends now, and the next sweep (≤ 10 min) sends the
 *    clipped order under the same orderId. The signed order keeps its own deadline: whichever lands first wins,
 *    because `usedOrder[orderId]` lets only one of them execute.
 *  - Block is a user-signed correction with chip "blocked"; the indexer then stops the fallback.
 */
export function bigMoveRoutes({ origins, auth, log, db }: BigMoveRouteOptions): Routes {
  return {
    ...authedRoute({
      path: BIG_MOVES_PATH,
      origins,
      auth,
      log,
      async handle({ identity }) {
        if (!db) return refusal(503, "BIG_MOVES_DISABLED", "Big moves aren't switched on yet.");
        const { rows } = await db.query<{
          order_id: Hex; decision: string; action_index: number; bot_id: string; name: string; asset: string; side: "BUY" | "SELL";
          bps: number; sig: Hex; deadline: string; reason: string | null;
        }>(
          `select '0x' || encode(m.order_id, 'hex') as order_id, m.decision_id::text as decision, m.action_index,
                  m.bot_id::text as bot_id, b.name, m.asset::text as asset, m.side::text as side, m.bps,
                  '0x' || encode(m.runner_sig, 'hex') as sig, extract(epoch from m.deadline)::bigint::text as deadline, d.reason
           from big_moves m join bots b on b.id = m.bot_id join decisions d on d.id = m.decision_id
           where b.owner_wallet = any($1::text[]) and m.status = 'pending' and m.deadline > now() and ${SEASON_OPEN}
           order by m.created_at, m.id`,
          [identity.wallets],
        );
        const bigMoves: PendingBigMove[] = [];
        for (const r of rows) {
          const decisionId = decisionIdFromUuid(r.decision);
          // The order the runner signed, rebuilt from the row. A row whose key doesn't match isn't served.
          if (orderIdOf(decisionId, r.action_index).toLowerCase() !== r.order_id.toLowerCase()) {
            log("big_moves.order_mismatch", { orderId: r.order_id });
            continue;
          }
          const order: ApprovedOrderJson = {
            botId: r.bot_id,
            asset: ASSET_IDS.indexOf(r.asset as (typeof ASSET_IDS)[number]),
            buy: r.side === "BUY",
            bps: r.bps,
            decisionId,
            actionIndex: r.action_index,
            deadline: r.deadline,
          };
          bigMoves.push({
            orderId: r.order_id,
            botId: r.bot_id,
            botName: r.name,
            asset: r.asset,
            side: r.side,
            bps: r.bps,
            deadline: new Date(Number(r.deadline) * 1000).toISOString(),
            reason: r.reason,
            signed: { order, runnerSig: r.sig },
          });
        }
        return { status: 200, body: { ok: true, bigMoves } };
      },
    }),
    ...authedRoute({
      path: BIG_MOVES_SHRINK_PATH,
      origins,
      auth,
      log,
      async handle({ identity, body }) {
        if (!db) return refusal(503, "BIG_MOVES_DISABLED", "Big moves aren't switched on yet.");
        const orderId = (body as { orderId?: unknown } | null)?.orderId;
        if (typeof orderId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(orderId)) {
          return refusal(400, "BAD_REQUEST", "Which big move? Send its orderId.");
        }
        const { rows } = await db.query(
          `update big_moves m set deadline = now() - interval '1 second'
           from bots b
           where m.order_id = decode($1::text, 'hex') and b.id = m.bot_id and b.owner_wallet = any($2::text[])
             and m.status = 'pending' and m.deadline > now() and ${SEASON_OPEN}
           returning m.id`,
          [orderId.slice(2).toLowerCase(), identity.wallets],
        );
        if (rows.length === 0) return refusal(404, "NOT_FOUND", "That big move isn't waiting for you any more.");
        return { status: 200, body: { ok: true, note: "Your bot sends the safe-size order within 10 minutes." } };
      },
    }),
  };
}
