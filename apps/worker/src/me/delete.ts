import { authedRoute } from "../auth/middleware";
import { errorLabel, InternalFailure, type Log } from "../auth/log";
import type { Authenticator } from "../auth/types";
import type { Db, Queryable } from "../relay/db";
import type { Routes } from "../server";

export const ME_DELETE_PATH = "/me/delete";

export interface DeletedData {
  /** `users` rows: wallet, Privy DID, login method, 18+ time, last seen, persona drafts. */
  users: number;
  /** Cached .qie names. They are public on QIE, so one comes back if your bot is shown again. */
  qieNames: number;
  /** Correction notes set to null. The rows, chips and on-chain note hashes stay. */
  correctionNotes: number;
  /** Bots whose personality text was blanked. The on-chain persona hash stays. */
  personas: number;
}

/**
 * Deletes or blanks what we hold off-chain about these wallets (#174). The rest stays: it is on-chain, or sealed by
 * a season's data root, and the indexer, leaderboards, replay files and trust proofs are rebuilt from it. Nothing
 * here touches decisions, trades, marks, versions, results or scores, so replay still matches. Idempotent.
 */
export async function deleteOffChainData(tx: Queryable, wallets: readonly string[], privyDid: string | null): Promise<DeletedData> {
  const count = async (sql: string, params: unknown[]) => (await tx.query(`${sql} returning 1`, params)).rows.length;
  return {
    users: await count("delete from users where wallet_address = any($1::text[]) or privy_did = $2::text", [wallets, privyDid]),
    qieNames: await count("delete from qie_names where wallet_address = any($1::text[])", [wallets]),
    correctionNotes: await count(
      "update corrections set note = null where user_wallet = any($1::text[]) and note is not null",
      [wallets],
    ),
    // House bots are the team's, not a user's.
    personas: await count(
      "update bots set persona_text = '' where owner_wallet = any($1::text[]) and not is_house and persona_text <> ''",
      [wallets],
    ),
  };
}

export interface MeRouteOptions {
  origins: ReadonlySet<string>;
  auth: Authenticator;
  log: Log;
  /** null = no DATABASE_URL: every call gets 503. */
  db: Pick<Db, "transaction"> | null;
  /** Deletes the Privy user for a passkey login. null when Privy isn't configured (then no Privy login exists). */
  privy: { deleteUser(did: string): Promise<void> } | null;
}

const refusal = (status: number, code: string, message: string) => ({ status, body: { ok: false, error: { code, message } } });

/**
 * POST /me/delete `{ confirm: true }`, signed in → `{ ok, deleted: DeletedData }`. Immediate, not queued: the
 * caller's wallet is proven by the sign-in, the work is four small statements in one transaction, and a queue
 * would need a new table. The Privy user goes last, so if that fails the caller can still sign in and retry.
 */
export function meRoutes({ origins, auth, log, db, privy }: MeRouteOptions): Routes {
  return authedRoute({
    path: ME_DELETE_PATH,
    origins,
    auth,
    log,
    async handle({ identity, body }) {
      if (!db) return refusal(503, "DELETE_DISABLED", "Deleting data isn't switched on yet.");
      if ((body as { confirm?: unknown } | null)?.confirm !== true) {
        return refusal(400, "BAD_REQUEST", "Send { confirm: true } to delete your data.");
      }
      const did = identity.privyDid ?? null;
      if (did && !privy) throw new InternalFailure("privy_not_configured");

      const deleted = await db.transaction((tx) => deleteOffChainData(tx, identity.wallets, did));
      log("me.deleted", { ...deleted }); // counts only, never the wallet or the DID
      if (did) {
        try {
          await privy!.deleteUser(did);
        } catch (error) {
          log("me.privy_delete_failed", { cause: errorLabel(error) });
          return refusal(502, "PRIVY_DELETE_FAILED", "We deleted your data here but couldn't remove your Privy sign-in. Please try again.");
        }
      }
      return { status: 200, body: { ok: true, deleted } };
    },
  });
}
