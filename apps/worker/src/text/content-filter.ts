import { containsUrl } from "./urls";

/*
 * SPEC §6.4 step 8 and §11: slurs, real-money advice and URLs in reason, roast and persona text.
 * Pure and deterministic, so a replay flags the same text. Changing these lists changes gate output:
 * do it together with a new rules version.
 * It is a word list, not a classifier. It will miss things.
 */

export type BannedRule = "slur" | "money_advice" | "url";

// base64 only so the slurs aren't readable in the repo. Decode with `Buffer.from(x, "base64")`.
const SLURS_B64 = [
  "bmlnZ2Vy", "bmlnZ2E=", "ZmFnZ290", "ZmFn", "a2lrZQ==", "d2V0YmFjaw==", "cmV0YXJk", "cmV0YXJkZWQ=",
  "dHJhbm55", "cGFraQ==", "Z29vaw==", "dG93ZWxoZWFk", "cmFnaGVhZA==", "YmVhbmVy", "c2hlbWFsZQ==",
  "Y2hhbWFy", "Ymhhbmdp", "a2F0dWE=", "a2F0d2E=", "Y2h1dGl5YQ==", "bWFkYXJjaG9k", "YmhlbmNob2Q=",
  "YmVoZW5jaG9k",
];

/**
 * Whole words only, so "Scunthorpe" is fine. Stretched letters match, but a doubled letter in the term
 * must be at least doubled in the text: that keeps the country Niger from matching.
 */
const SLURS = SLURS_B64.map((b64) =>
  Buffer.from(b64, "base64")
    .toString("utf8")
    .replace(/([a-z])\1*/g, (run, letter: string) => `${letter}{${run.length},}`),
).join("|");
const SLUR_WORD = new RegExp(`(?<![a-z])(?:${SLURS})(?:e?s)?(?![a-z])`);
/** No word edges: only for runs of single letters, where "what a x y z" reads as "axyz". */
const SLUR_IN_RUN = new RegExp(SLURS);

const BROKERS =
  "binance|coinbase|kraken|kucoin|bybit|okx|bitget|upbit|wazirx|coindcx|coinswitch|zebpay|robinhood|etoro|zerodha|groww|upstox";

const MONEY_ADVICE: readonly RegExp[] = [
  new RegExp(`\\b(?:${BROKERS})\\b`),
  // "buy now on …", but "buy now on the dip" is ordinary bot talk.
  /\b(?:buy|sell|trade|invest)(?: \w+){0,2} now (?:on|via)\b(?! (?:the |this |a )?dips?\b)/,
  /\b(?:guaranteed|risk[ -]?free|sure[ -]?shot) (?:profits?|returns?|gains?|money|income)\b/,
  /\b(?:you|everyone|y'all) (?:should|must|need to|gotta|ought to|have to) (?:buy|sell|invest)\b/,
  /\binvest (?:your|real) /,
  /\bput (?:all )?your (?:money|savings|salary) /,
  /\byour (?:life savings|savings|salary|rent money)\b/,
  /(?<!\b(?:no|not|never|zero|without|isn't) )\breal (?:money|cash|rupees|funds)\b/,
  /\b(?:buy|sell|invest)\b[^.!?]{0,20}\b(?:for real|irl|in real life)\b/,
  /\btake (?:out )?a loan\b/,
  /\b(?:paisa|paise) laga(?:o|iye|do)\b/,
];

const LOOKALIKES: Readonly<Record<string, string>> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "к": "k",
};
const LEET: Readonly<Record<string, string>> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s",
};

/** Lower case, no accents, no invisible characters, Latin for common Cyrillic lookalikes, single spaces. */
function normalise(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ\p{Cf}]/gu, "")
    .toLowerCase()
    .replace(/[аеорсухік]/g, (c) => LOOKALIKES[c]!)
    .replace(/’/g, "'")
    .replace(/[\s_]+/g, " ");
}

function hasSlur(normalised: string): boolean {
  const letters = normalised.replace(/[013457@$]/g, (c) => LEET[c]!);
  if (SLUR_WORD.test(letters)) return true;
  // "x.y z" style spelling: three or more single letters in a row are read as one run.
  const runs: string[] = letters.match(/(?<![a-z])[a-z](?:[^a-z]+[a-z](?![a-z])){2,}/g) ?? [];
  return runs.some((run) => SLUR_IN_RUN.test(run.replace(/[^a-z]/g, "")));
}

/** Every rule the text breaks. Empty = clean. */
export function bannedRules(text: string): BannedRule[] {
  const normal = normalise(text);
  const found: BannedRule[] = [];
  if (hasSlur(normal)) found.push("slur");
  if (MONEY_ADVICE.some((pattern) => pattern.test(normal))) found.push("money_advice");
  if (containsUrl(normal)) found.push("url");
  return found;
}
