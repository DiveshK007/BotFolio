/**
 * The one-sentence bot description (SPEC §2.1). It is untrusted user text (#159):
 * React escapes it when rendering; we never put it in dangerouslySetInnerHTML, URLs we build, or HTML attributes we assemble by hand.
 */

/** SPEC §2.1 tap-to-fill examples, verbatim. Crypto/gold only (SPEC §1). */
export const EXAMPLE_SENTENCES = [
  "Careful like my dad, loves gold",
  "YOLO Bitcoin maxi, never sells",
  "Buys dips on SOL and XRP, takes profit fast",
] as const;

/**
 * Input cap. SPEC caps the persona output (≤ 120 chars, §6.3) but not the input sentence.
 * UNVERIFIED: 160 is our pick until the worker's persona endpoint (#41) states its own limit.
 */
export const SENTENCE_MAX = 160;
export const SENTENCE_MIN = 3;

// SPEC §11: "no URLs in persona". The worker filters too; this just tells the user early.
const URL_LIKE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|in|io|xyz|net|org|app|link|me|co|gg|ly)\b)/i;

export type SentenceCheck = { ok: true; value: string } | { ok: false; error: string };

export function checkSentence(raw: string): SentenceCheck {
  // Collapse whitespace (incl. newlines) so what the user sees is what we send.
  const value = raw.replace(/\s+/g, " ").trim();
  if (value.length < SENTENCE_MIN) return { ok: false, error: "Tell us a little about your bot first." };
  if (value.length > SENTENCE_MAX) return { ok: false, error: `Keep it to one sentence (${SENTENCE_MAX} characters max).` };
  if (URL_LIKE.test(value)) return { ok: false, error: "No links, please. Just describe how your bot should trade." };
  return { ok: true, value };
}
