import { describe, expect, it } from "vitest";
import type { PublicBot } from "@/lib/bots";
import { S1_STARTS, type Leaderboards } from "@/lib/leaderboards";
import { arenaRacers, botOfWeek } from "./live";

const entry = (botId: string, isHouse = false) => ({ botId, name: `B${botId}`, emoji: "", isHouse, ownerQieName: null, rank: 1 });
const boards: Leaderboards = {
  season: 1, live: true, trustSeason: 1,
  topReturns: [{ ...entry("7"), returnBps: 250, maxDdBps: 1 }],
  bestRiskAdjusted: [], mostTrusted: [{ ...entry("2", true), total: 900 }, { ...entry("7"), total: 800 }], coachVsBot: [],
};
const listed: PublicBot[] = [{ botId: "4", name: "Real", emoji: "", isHouse: false, version: 1, createdAt: "2026-11-26T00:00:00Z", dnaSeed: "s" }];

describe("arena racers (#371)", () => {
  it("uses EXAMPLE racers only when no worker is configured", async () => {
    expect((await arenaRacers(null)).example).toBe(true);
  });
  it("shows the board when it has returns", async () => {
    const r = await arenaRacers("https://w", async () => boards, async () => listed);
    expect(r).toMatchObject({ example: false, data: [{ id: "7", ret: 2.5 }] });
    expect(r.note).toBeUndefined();
  });
  it("shows real bots with the S1 start while the board is hidden, never example bots", async () => {
    const r = await arenaRacers("https://w", async () => null, async () => listed);
    expect(r).toMatchObject({ example: false, note: S1_STARTS, data: [{ id: "4", name: "Real", dnaSeed: "s", ret: 0 }] });
    expect(await arenaRacers("https://w", async () => null, async () => null)).toMatchObject({ example: false, data: [] });
  });
});

describe("bot of the week (#371)", () => {
  it("is the example only without a worker, hidden with no data, else the most trusted human bot", async () => {
    expect((await botOfWeek(null))?.example).toBe(true);
    expect(await botOfWeek("https://w", async () => null)).toBeNull();
    expect(await botOfWeek("https://w", async () => boards)).toMatchObject({ example: false, data: { id: "7", stat: "trust 800/1000" } });
  });
});
