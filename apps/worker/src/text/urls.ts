/**
 * URL matcher for "no URLs in persona" (SPEC §11): schemes, www., and bare domains on common TLDs.
 * A known-TLD list keeps "e.g." and "3.5x" from matching. It is not a complete TLD list.
 */
const URL_PATTERN = new RegExp(
  [
    String.raw`\b[a-z][a-z0-9+-]{1,15}://\S+`,
    String.raw`\bwww\.\S+`,
    String.raw`\b(?:[a-z0-9-]{1,63}\.){1,4}` +
      "(?:com|net|org|io|xyz|app|dev|finance|exchange|link|site|online|digital|gg|ly|me|co|in|ai|sh|fun|club|top|info|shop|store)" +
      String.raw`\b(?:/\S*)?`,
  ].join("|"),
  "giu",
);

export function containsUrl(text: string): boolean {
  return new RegExp(URL_PATTERN.source, "iu").test(text);
}

export function stripUrls(text: string): string {
  return text.replace(URL_PATTERN, "");
}
