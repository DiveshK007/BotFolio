import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../src/scheduler/db";
import { markSeasonsClosing, openDueSeasons } from "../../src/seasons/checks";
import type { SeasonChain } from "../../src/seasons/ledger";

const sql = (path: string) => readFileSync(new URL(`../../../../packages/db/${path}`, import.meta.url), "utf8");
const ist = (time: string) => new Date(`${time}+05:30`);

let pglite: PGlite;
let db: Queryable;
// `closedOnChain` stands in for the close job: true means every opened season's close has landed.
let chain: SeasonChain & { opened: { n: number; start: string; end: string }[]; lagging: boolean; closedOnChain: boolean };
const log = { info: vi.fn(), warn: vi.fn() };

beforeEach(async () => {
  pglite = new PGlite();
  await pglite.exec(sql("schema.sql"));
  await pglite.exec(sql("seeds/seasons.sql"));
  db = { query: async <Row extends object>(text: string, params?: unknown[]) => ({ rows: (await pglite.query<Row>(text, params)).rows }) };
  chain = {
    opened: [],
    lagging: false,
    closedOnChain: true,
    async nextSeason() {
      return this.lagging ? 0 : this.opened.length;
    },
    async isClosed(n) {
      return this.closedOnChain && n < this.opened.length;
    },
    closeSeason: async () => {},
    async openSeason(n, startsAt, endsAt) {
      // As SeasonLedger does.
      if (n !== this.opened.length) throw new Error("BadSeason");
      if (n > 0 && !(await this.isClosed(n - 1))) throw new Error("PreviousSeasonOpen");
      this.opened.push({ n, start: startsAt.toISOString(), end: endsAt.toISOString() });
    },
  };
}, 30_000);
afterEach(() => pglite.close());

const run = (check: typeof openDueSeasons, at: string, signal = new AbortController().signal) =>
  check({ db, chain, now: ist(at), signal, log });

describe("openDueSeasons", () => {
  it("opens nothing before S0's 00:00 IST", async () => {
    expect(await run(openDueSeasons, "2026-11-26T23:59:59")).toEqual([]);
    expect(chain.opened).toEqual([]);
  });

  it("opens S0 at 00:00 IST with the row's times", async () => {
    expect(await run(openDueSeasons, "2026-11-27T00:00:00")).toEqual([0]);
    expect(chain.opened).toEqual([
      { n: 0, start: ist("2026-11-27T00:00:00").toISOString(), end: ist("2026-11-28T21:30:00").toISOString() },
    ]);
  });

  it("is idempotent: a rerun or a restart opens nothing twice", async () => {
    await run(openDueSeasons, "2026-11-27T00:00:00");
    expect(await run(openDueSeasons, "2026-11-27T00:05:00")).toEqual([]);
    expect(chain.opened).toHaveLength(1);
  });

  it("a late deploy opens what it missed, in order, even a season that has already ended", async () => {
    expect(await run(openDueSeasons, "2026-12-01T10:00:00")).toEqual([0, 1, 2]);
  });

  it("stops, without sending, while the previous season isn't closed on-chain (#219)", async () => {
    chain.closedOnChain = false;
    expect(await run(openDueSeasons, "2026-12-01T10:00:00")).toEqual([0]);
    expect(await run(openDueSeasons, "2026-12-02T00:00:00")).toEqual([]);
    expect(log.warn).toHaveBeenCalledWith("seasons.previous_not_closed", { season: 1 });

    chain.closedOnChain = true; // S0's close landed
    expect(await run(openDueSeasons, "2026-12-03T00:00:00")).toEqual([1, 2, 3]);
  });

  it("follows a boundary that was moved in the table", async () => {
    await pglite.exec("update seasons set starts_at = '2026-11-27 06:00:00+05:30' where id = 0");
    expect(await run(openDueSeasons, "2026-11-27T05:59:00")).toEqual([]);
    expect(await run(openDueSeasons, "2026-11-27T06:00:00")).toEqual([0]);
  });

  it("sprint → weekly needs no code change", async () => {
    await run(openDueSeasons, "2026-12-05T00:00:00");
    expect(chain.opened).toHaveLength(5); // S0-S4
    expect(await run(openDueSeasons, "2026-12-07T00:00:00")).toEqual([5]);
    expect(await run(openDueSeasons, "2026-12-13T23:59:00")).toEqual([]); // a week, not two days
    expect(await run(openDueSeasons, "2026-12-14T00:00:00")).toEqual([6]);
  });

  it("stops instead of sending again when the RPC hasn't seen the open yet", async () => {
    chain.lagging = true;
    expect(await run(openDueSeasons, "2026-12-01T10:00:00")).toEqual([0]);
    expect(chain.opened).toHaveLength(1);
  });

  it("fails loudly when the seasons aren't seeded", async () => {
    await pglite.exec("delete from seasons");
    await expect(run(openDueSeasons, "2026-11-27T00:00:00")).rejects.toThrow("season_row_missing");
  });

  it("stops quietly after the last seeded season instead of failing every day (#313)", async () => {
    await pglite.exec("delete from seasons where id > 2");
    expect(await run(openDueSeasons, "2026-12-20T00:00:00")).toEqual([0, 1, 2]);
    expect(await run(openDueSeasons, "2026-12-21T00:00:00")).toEqual([]);
    expect(log.warn).toHaveBeenCalledWith("seasons.no_next_row", { season: 3 });
  });

  it("starts nothing new once the worker is shutting down", async () => {
    expect(await run(openDueSeasons, "2026-12-01T10:00:00", AbortSignal.abort())).toEqual([]);
  });
});

describe("markSeasonsClosing", () => {
  const status = async (id: number) =>
    (await pglite.query<{ status: string }>("select status::text as status from seasons where id = $1", [id])).rows[0]!.status;

  beforeEach(async () => {
    await run(openDueSeasons, "2026-11-27T00:00:00");
  });

  it("leaves the season open through its 21:00 slot", async () => {
    expect(await run(markSeasonsClosing, "2026-11-28T21:29:59")).toEqual([]);
    expect(await status(0)).toBe("open");
  });

  it("marks it closing at 21:30, once, and never closed", async () => {
    expect(await run(markSeasonsClosing, "2026-11-28T21:30:00")).toEqual([0]);
    expect(await status(0)).toBe("closing");
    expect(await run(markSeasonsClosing, "2026-11-28T21:40:00")).toEqual([]);
  });

  it("never touches a season that isn't open on-chain, or one already closed", async () => {
    await pglite.exec("update seasons set status = 'closed' where id = 0");
    expect(await run(markSeasonsClosing, "2026-12-01T00:00:00")).toEqual([]);
    expect(await status(0)).toBe("closed");
    expect(await status(1)).toBe("open");
  });
});

describe("the seeded calendar across the sprint → weekly switch (#179)", () => {
  const day = (start: string, plus: number) => new Date(Date.parse(`${start}T00:00:00Z`) + plus * 86_400_000).toISOString().slice(0, 10);

  it("closes S4 on Sun Dec 6, opens S5 on Mon Dec 7, then one season a week through S18's close", async () => {
    await run(openDueSeasons, "2026-12-05T00:00:00"); // S0-S4
    await pglite.exec("update seasons set status = 'closed' where id < 4");

    // The scheduler's two daily checks (SPEC §6.1), every IST day from S4's open to the day after S18's close.
    // S18 is the last seeded row, so the Mar 15 open check finds no S19 row and opens nothing (#313).
    const events: string[] = [];
    for (let d = 0; d <= 100; d++) {
      const date = day("2026-12-05", d);
      for (const id of await run(openDueSeasons, `${date}T00:00:00`)) events.push(`${date} open S${id}`);
      for (const id of await run(markSeasonsClosing, `${date}T21:30:00`)) events.push(`${date} close S${id}`);
    }

    const expected = ["2026-12-06 close S4"];
    for (let id = 5; id <= 18; id++) {
      const week = 7 * (id - 5);
      expected.push(`${day("2026-12-07", week)} open S${id}`, `${day("2026-12-13", week)} close S${id}`);
    }
    expect(events).toEqual(expected);
    expect(events.at(-1)).toBe("2027-03-14 close S18");
    expect(log.warn).toHaveBeenCalledWith("seasons.no_next_row", { season: 19 });

    // Each season went on-chain with its own row's IST times: Monday 00:00 to Sunday 21:30.
    expect(chain.opened[4]).toEqual({ n: 4, start: ist("2026-12-05T00:00:00").toISOString(), end: ist("2026-12-06T21:30:00").toISOString() });
    expect(chain.opened[5]).toEqual({ n: 5, start: ist("2026-12-07T00:00:00").toISOString(), end: ist("2026-12-13T21:30:00").toISOString() });

    const { rows } = await pglite.query(
      "select id, kind::text as kind, provisional_min_trades as n, trust_rules_version as rules from seasons where id in (4, 5) order by id",
    );
    expect(rows).toEqual([
      { id: 4, kind: "sprint", n: 8, rules: "trust-v1-sprint" },
      { id: 5, kind: "weekly", n: 20, rules: "trust-v1" },
    ]);
  });
});
