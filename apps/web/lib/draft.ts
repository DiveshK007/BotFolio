/**
 * Carries the bot sentence from S1 to S2 inside this tab.
 *
 * It is deliberately not a query param: free text from users would land in server logs and referrers, and
 * anyone could send a link that pre-loads a prompt of their choice into someone else's bot (#159).
 */
const KEY = "bf-draft-sentence";

// Backup for browsers that block storage. It survives client-side navigation, not a reload.
let inMemory = "";

export function saveDraft(sentence: string): void {
  inMemory = sentence;
  try {
    sessionStorage.setItem(KEY, sentence);
  } catch {
    // Storage blocked: the in-memory copy is enough for S1 → S2.
  }
}

export function readDraft(): string {
  try {
    return sessionStorage.getItem(KEY) ?? inMemory;
  } catch {
    return inMemory;
  }
}

const CHALLENGE_KEY = "bf-pending-challenge";
const SHORT = /^[0-9a-f]{16}$/;

/**
 * A newcomer who opened a challenge link and tapped "Make a bot" (#85): after createBot, /create sends them back
 * to /challenge/<code> to accept. Only an 8-byte hex code is kept, never free text.
 */
export function savePendingChallenge(code: string): void {
  if (!SHORT.test(code)) return;
  try {
    sessionStorage.setItem(CHALLENGE_KEY, code);
  } catch {
    // Storage blocked: they reopen the link by hand, as the page says.
  }
}

/** The pending challenge code, removed as it is read. */
export function takePendingChallenge(): string | null {
  try {
    const code = sessionStorage.getItem(CHALLENGE_KEY);
    sessionStorage.removeItem(CHALLENGE_KEY);
    return code && SHORT.test(code) ? code : null;
  } catch {
    return null;
  }
}
