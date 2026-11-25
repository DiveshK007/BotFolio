import { describe, expect, it } from "vitest";
import { botSeed, dnaSvg, dnaTraits, sentenceSeed } from "./dna";

const norm = (s: string) => s.replace(/dna\d+_[\w-]+/g, "ID");
describe("bot DNA", () => {
  it("is deterministic for the same seed", () => {
    expect(norm(dnaSvg({ seed: botSeed(12), hint: "Gold Guru" }))).toBe(norm(dnaSvg({ seed: botSeed(12), hint: "Gold Guru" })));
    expect(sentenceSeed("  YOLO Bitcoin ")).toBe(sentenceSeed("yolo bitcoin"));
  });
  it("pins persona traits from keywords", () => {
    expect(dnaTraits("x", "Gold Guru").pal[0]).toBe("#FFC93C");
    expect(dnaTraits("x", "AlphaWolf").acc).toBe("ears");
  });
  it("shows evolution from version 2", () => {
    expect(dnaSvg({ seed: "s", version: 1 })).not.toContain('data-part="evo"');
    expect(dnaSvg({ seed: "s", version: 2 })).toContain(">v2<");
  });
  it("uses the given uid for hydration-safe clip ids", () => {
    expect(dnaSvg({ seed: "s", uid: "abc" })).toContain('_abc"');
  });
});
