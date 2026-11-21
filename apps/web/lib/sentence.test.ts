import { describe, expect, it } from "vitest";
import { EXAMPLE_SENTENCES, SENTENCE_MAX, checkSentence } from "./sentence";

describe("checkSentence", () => {
  it("accepts every SPEC §2.1 example", () => {
    for (const s of EXAMPLE_SENTENCES) expect(checkSentence(s)).toEqual({ ok: true, value: s });
  });

  it("trims and collapses whitespace", () => {
    expect(checkSentence("  loves   gold\n\nnever sells ")).toEqual({ ok: true, value: "loves gold never sells" });
  });

  it("rejects empty and too-short input", () => {
    expect(checkSentence("").ok).toBe(false);
    expect(checkSentence("  a ").ok).toBe(false);
  });

  it("rejects input over the cap", () => {
    expect(checkSentence("x".repeat(SENTENCE_MAX)).ok).toBe(true);
    expect(checkSentence("x".repeat(SENTENCE_MAX + 1)).ok).toBe(false);
  });

  it("rejects links (SPEC §11: no URLs in persona)", () => {
    for (const s of ["buy gold, see https://evil.example", "check www.pump.xyz", "join t.me now", "visit scam.com today"])
      expect(checkSentence(s).ok).toBe(false);
  });

  it("keeps markup as plain text (rendering escapes it, #159)", () => {
    const s = '<img src=x onerror="alert(1)"> loves gold';
    expect(checkSentence(s)).toEqual({ ok: true, value: s });
  });
});
