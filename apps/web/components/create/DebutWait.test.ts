import { describe, expect, it } from "vitest";
import { samplePage } from "@/lib/bot-record.fixture";
import { debutLanded } from "./DebutWait";

describe("debutLanded", () => {
  it("waits while the indexer hasn't got the bot, or the runner hasn't made its first call", () => {
    expect(debutLanded({ kind: "not_found" })).toBe(false);
    expect(debutLanded({ kind: "busy" })).toBe(false);
    expect(debutLanded({ kind: "ok", page: { ...samplePage(), trades: [], decisions: [] } })).toBe(false);
  });

  it("is done on the first trade, or on a hold (stale prices still count as the debut call)", () => {
    const page = samplePage();
    expect(debutLanded({ kind: "ok", page })).toBe(true);
    expect(page.decisions.length).toBeGreaterThan(0);
    expect(debutLanded({ kind: "ok", page: { ...page, trades: [] } })).toBe(true);
  });
});
