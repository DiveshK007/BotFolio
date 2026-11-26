import { keccak256, stringToHex, type Hex } from "viem";
import { authedRoute } from "../auth/middleware";
import type { Log } from "../auth/log";
import type { Authenticator } from "../auth/types";
import { pgSafeText } from "../decisions/json";
import { CHIPS } from "../indexer/handlers/season-ledger";
import type { Queryable } from "../scheduler/db";
import type { Routes } from "../server";
import { bannedRules } from "../text/content-filter";

export const CORRECTION_NOTE_PATH = "/corrections/note";
/** Same cap as the corrections.note check (char_length, so code points). */
export const MAX_NOTE_CHARS = 80;
/** Pending notes per bot per 24 h: the on-chain cap is 20 corrections a day, so more can't all be real. */
export const MAX_PENDING_PER_DAY = 20;

export interface CorrectionNoteRouteOptions {
  origins: ReadonlySet<string>;
  auth: Authenticator;
  log: Log;
  /** null = no DATABASE_URL: every call gets 503. */
  db: Queryable | null;
}

const refusal = (status: number, code: string, message: string) => ({ status, body: { ok: false, error: { code, message } } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BOT_ID = /^[1-9]\d{0,18}$/;

/**
 * POST /corrections/note `{ botId, decisionId (uuid), chip (0..3), note, noteHash }` → `{ ok }` (#79).
 * Only `keccak256(note)` goes on-chain (SPEC §4.4). The app sends the text here before signing recordCorrection,
 * and this stores it as a pending `corrections` row (tx_hash null). The indexer's CallCorrected handler then
 * attaches the on-chain event to it when bot, decision, chip, note hash and owner all match, so only a note the
 * owner really signed ever reaches the v2 proposal or the decision prompt (both read tx_hash is not null).
 * A note with a link, real-money advice or a slur is refused, never rewritten: the stored text must hash to what
 * the owner signs.
 */
export function correctionNoteRoutes({ origins, auth, log, db }: CorrectionNoteRouteOptions): Routes {
  return authedRoute({
    path: CORRECTION_NOTE_PATH,
    origins,
    auth,
    log,
    async handle({ identity, body }) {
      if (!db) return refusal(503, "CORRECTIONS_DISABLED", "Corrections aren't switched on yet.");
      const b = (body ?? {}) as { botId?: unknown; decisionId?: unknown; chip?: unknown; note?: unknown; noteHash?: unknown };
      const botId = typeof b.botId === "number" && Number.isSafeInteger(b.botId) ? String(b.botId) : b.botId;
      const decision = typeof b.decisionId === "string" ? b.decisionId.toLowerCase() : "";
      const chip = Number.isInteger(b.chip) ? CHIPS[b.chip as number] : undefined;
      if (typeof botId !== "string" || !BOT_ID.test(botId) || !UUID.test(decision) || !chip || chip === "blocked") {
        return refusal(400, "BAD_REQUEST", "Which call, and what was wrong with it?");
      }
      const note = b.note;
      if (typeof note !== "string" || note.trim() !== note || note === "" || [...note].length > MAX_NOTE_CHARS) {
        return refusal(400, "BAD_NOTE", `Keep the note to one line of up to ${MAX_NOTE_CHARS} characters.`);
      }
      if (/[\p{Cc}]/u.test(note) || pgSafeText(note) !== note || bannedRules(note).length > 0) {
        return refusal(400, "BAD_NOTE", "That note can't be used. No links and no real-money advice.");
      }

      const noteHash: Hex = keccak256(stringToHex(note));
      // The hash the owner is about to sign must cover exactly this text.
      if (typeof b.noteHash !== "string" || b.noteHash.toLowerCase() !== noteHash) {
        return refusal(400, "BAD_NOTE_HASH", "That note doesn't match its hash. Nothing was saved.");
      }

      const { rows } = await db.query<{ owner: string; pending: number }>(
        `select b.owner_wallet as owner,
                (select count(*)::int from corrections c
                 where c.bot_id = b.id and c.tx_hash is null and c.created_at > now() - interval '1 day') as pending
         from bots b join decisions d on d.bot_id = b.id
         where b.id = $1::bigint and d.id = $2::uuid and b.owner_wallet = any($3::text[]) and not b.is_house`,
        [botId, decision, identity.wallets],
      );
      const found = rows[0];
      if (!found) return refusal(404, "NOT_FOUND", "That isn't a call by one of your bots.");
      if (found.pending >= MAX_PENDING_PER_DAY) return refusal(429, "RATE_LIMITED_USER", "That's a lot of notes today. Try again tomorrow.");

      // A retry of the same note isn't stored twice.
      await db.query(
        `insert into corrections (bot_id, decision_id, user_wallet, chip, note, note_hash)
         select $1::bigint, $2::uuid, $3::text, $4::text, $5::text, decode($6::text, 'hex')
         where not exists (select 1 from corrections
                           where bot_id = $1::bigint and decision_id = $2::uuid and chip = $4::text
                             and note_hash = decode($6::text, 'hex') and tx_hash is null)`,
        [botId, decision, found.owner, chip, note, noteHash.slice(2)],
      );
      return { status: 200, body: { ok: true } };
    },
  });
}
