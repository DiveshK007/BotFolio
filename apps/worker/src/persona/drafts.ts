import type { Hex } from "viem";
import { pgSafeText } from "../decisions/json";
import type { Persona } from "./persona";

interface Queryable {
  query<Row extends object = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

/** How many drafts one wallet keeps: enough for a few "try again"s before Launch. */
export const DRAFTS_KEPT = 10;

/*
 * A bot's name and text exist before its id does, and BotCreated carries only the hash. So the drafts live in
 * `users.flags.personas[personaHash]` (users is never anon-readable) until the debut watcher or the indexer
 * sees a bot by that owner with that hash.
 */

export async function personaDraft(db: Queryable, owner: string, personaHash: Hex): Promise<Persona | null> {
  const { rows } = await db.query<{ draft: Record<string, unknown> | null }>(
    "select flags #> array['personas', $2::text] as draft from users where wallet_address = $1::text",
    [owner.toLowerCase(), personaHash.toLowerCase()],
  );
  const draft = rows[0]?.draft;
  if (!draft) return null;
  const field = (name: keyof Persona) => {
    const value = draft[name];
    return typeof value === "string" ? pgSafeText(value) : "";
  };
  return { name: field("name"), emoji: field("emoji"), persona: field("persona"), rules: field("rules") };
}

export interface DraftOwner {
  wallet: string;
  privyDid: string | null;
  loginMethod: "passkey" | "qie_wallet";
}

/**
 * Saves the draft, and on a first visit the user row with `terms_accepted_at` (SPEC §3, §11: 18+ and Terms).
 * The first acceptance stands. Call it inside a transaction.
 */
export async function savePersonaDraft(
  tx: Queryable,
  owner: DraftOwner,
  personaHash: Hex,
  persona: Persona,
  now: Date,
): Promise<void> {
  const wallet = owner.wallet.toLowerCase();
  await tx.query(
    `insert into users (wallet_address, privy_did, login_method, terms_accepted_at, last_seen_at)
     values ($1::text,
             case when exists (select 1 from users where privy_did = $2::text) then null else $2::text end,
             $3::login_method, $4::timestamptz, $4::timestamptz)
     on conflict (wallet_address) do update set last_seen_at = excluded.last_seen_at`,
    [wallet, owner.privyDid, owner.loginMethod, now.toISOString()],
  );
  const { rows } = await tx.query<{ personas: Record<string, { at?: string }> | null }>(
    "select flags -> 'personas' as personas from users where wallet_address = $1::text for update",
    [wallet],
  );
  const text = (value: string) => pgSafeText(value);
  const all = {
    ...rows[0]?.personas,
    [personaHash.toLowerCase()]: {
      name: text(persona.name),
      emoji: text(persona.emoji),
      persona: text(persona.persona),
      rules: text(persona.rules),
      at: now.toISOString(),
    },
  };
  const kept = Object.fromEntries(
    Object.entries(all)
      .sort(([, a], [, b]) => (b.at ?? "").localeCompare(a.at ?? ""))
      .slice(0, DRAFTS_KEPT),
  );
  await tx.query(
    "update users set flags = flags || jsonb_build_object('personas', $2::jsonb) where wallet_address = $1::text",
    [wallet, JSON.stringify(kept)],
  );
}
