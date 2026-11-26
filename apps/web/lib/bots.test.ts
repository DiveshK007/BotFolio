import { describe, expect, it, vi } from "vitest";
import { fetchBots, parseBots } from "./bots";

const bot = { botId: "7", name: "AlphaWolf", emoji: "🐺", isHouse: false, version: 2, createdAt: "2026-11-22T10:00:00.000Z" };

describe("GET /bots client", () => {
  it("accepts the worker's shape and rejects anything off", () => {
    expect(parseBots({ ok: true, bots: [bot] })).toEqual([bot]);
    expect(parseBots({ ok: true, bots: [{ ...bot, botId: "07" }] })).toBeNull();
    expect(parseBots({ ok: true, bots: [{ ...bot, version: 0 }] })).toBeNull();
    expect(parseBots({ ok: false })).toBeNull();
  });
  it("returns null (fall back to boards) on 404, 503 or a network error", async () => {
    expect(await fetchBots("https://w", vi.fn<typeof fetch>(async () => new Response("{}", { status: 404 })))).toBeNull();
    expect(await fetchBots("https://w", vi.fn<typeof fetch>(async () => { throw new Error("down"); }))).toBeNull();
    expect(await fetchBots("https://w", vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true, bots: [bot] }))))).toEqual([bot]);
  });
});
