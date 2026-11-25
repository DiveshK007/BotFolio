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
let chain: SeasonChain & { opened: { n: number; start: string; end: string }[]; lagging: boolean };
const log = { info: vi.fn(), warn: vi.fn() };

beforeEach(async () => {
  pglite = new PGlite();
  await pglite.exec(sql("schema.sql"));
  await pglite.exec(sql("seeds/seasons.sql"));
  db = { query: async <Row extends object>(text: string, params?: unknown[]) => ({ rows: (await pglite.query<Row>(text, params)).rows }) };
  chain = {
    opened: [],
    lagging: false,
    async nextSeason() {
      return this.lagging ? 0 : this.opened.length;
    },
    isClosed: async () => false,
    closeSeason: async () => {},
    async openSeason(n, startsAt, endsAt) {
      if (n !== this.opened.length) throw new Error("BadSeason"); // as SeasonLedger does
      this.opened.push({ n, start: startsAt.toISOString(), end: endsAt.toISOString() });
    },
  };
}, 30_000);
afterEach(() => pglite.close());

const run = (check: typeof openDueSeasons, at: string, signal = new AbortController().signal) =>
  check({ db, chain, now: ist(at), signal, log });

describe("openDueSeasons", () => {
  it("opens nothing before S0's 00:00 IST", async () => {
    expect(await run(openDueSeasons, "2026-11-23T23:59:59")).toEqual([]);
    expect(chain.opened).toEqual([]);
  });

  it("opens S0 at 00:00 IST with the row's times", async () => {
    expect(await run(openDueSeasons, "2026-11-24T00:00:00")).toEqual([0]);
    expect(chain.opened).toEqual([
      { n: 0, start: ist("2026-11-24T00:00:00").toISOString(), end: ist("2026-11-25T21:30:00").toISOString() },
    ]);
  });

  it("is idempotent: a rerun or a restart opens nothing twice", async () => {
    await run(openDueSeasons, "2026-11-24T00:00:00");
    expect(await run(openDueSeasons, "2026-11-24T00:05:00")).toEqual([]);
    expect(chain.opened).toHaveLength(1);
  });

  it("a late deploy opens what it missed, in order, even a season that has already ended", async () => {
    expect(await run(openDueSeasons, "2026-11-28T10:00:00")).toEqual([0, 1, 2]);
  });

  it("follows a boundary that was moved in the table", async () => {
    await pglite.exec("update seasons set starts_at = '2026-11-24 06:00:00+05:30' where id = 0");
    expect(await run(openDueSeasons, "2026-11-24T05:59:00")).toEqual([]);
    expect(await run(openDueSeasons, "2026-11-24T06:00:00")).toEqual([0]);
  });

  it("sprint → weekly needs no code change", async () => {
    await run(openDueSeasons, "2026-12-04T00:00:00");
    expect(chain.opened).toHaveLength(6); // S0-S5
    expect(await run(openDueSeasons, "2026-12-07T00:00:00")).toEqual([6]);
    expect(await run(openDueSeasons, "2026-12-13T23:59:00")).toEqual([]); // a week, not two days
    expect(await run(openDueSeasons, "2026-12-14T00:00:00")).toEqual([7]);
  });

  it("stops instead of sending again when the RPC hasn't seen the open yet", async () => {
    chain.lagging = true;
    expect(await run(openDueSeasons, "2026-11-28T10:00:00")).toEqual([0]);
    expect(chain.opened).toHaveLength(1);
  });

  it("fails loudly when the seasons aren't seeded", async () => {
    await pglite.exec("delete from seasons");
    await expect(run(openDueSeasons, "2026-11-24T00:00:00")).rejects.toThrow("season_row_missing");
  });

  it("starts nothing new once the worker is shutting down", async () => {
    expect(await run(openDueSeasons, "2026-11-28T10:00:00", AbortSignal.abort())).toEqual([]);
  });
});

describe("markSeasonsClosing", () => {
  const status = async (id: number) =>
    (await pglite.query<{ status: string }>("select status::text as status from seasons where id = $1", [id])).rows[0]!.status;

  beforeEach(async () => {
    await run(openDueSeasons, "2026-11-24T00:00:00");
  });

  it("leaves the season open through its 21:00 slot", async () => {
    expect(await run(markSeasonsClosing, "2026-11-25T21:29:59")).toEqual([]);
    expect(await status(0)).toBe("open");
  });

  it("marks it closing at 21:30, once, and never closed", async () => {
    expect(await run(markSeasonsClosing, "2026-11-25T21:30:00")).toEqual([0]);
    expect(await status(0)).toBe("closing");
    expect(await run(markSeasonsClosing, "2026-11-25T21:40:00")).toEqual([]);
  });

  it("never touches a season that isn't open on-chain, or one already closed", async () => {
    await pglite.exec("update seasons set status = 'closed' where id = 0");
    expect(await run(markSeasonsClosing, "2026-11-30T00:00:00")).toEqual([]);
    expect(await status(0)).toBe("closed");
    expect(await status(1)).toBe("open");
  });
});

describe("the seeded calendar across the sprint → weekly switch (#179)", () => {
  const day = (start: string, plus: number) => new Date(Date.parse(`${start}T00:00:00Z`) + plus * 86_400_000).toISOString().slice(0, 10);

  it("closes S5 on Sun Dec 6, opens S6 on Mon Dec 7, then one season a week through S18's close", async () => {
    await run(openDueSeasons, "2026-12-04T00:00:00"); // S0-S5
    await pglite.exec("update seasons set status = 'closed' where id < 5");

    // The scheduler's two daily checks (SPEC §6.1), every IST day from S5's open to S18's close (Sun Mar 7).
    // Stops there: S19 is the last seeded row, so the Mar 8 open check finds no S20 row and throws.
    const events: string[] = [];
    for (let d = 0; d <= 93; d++) {
      const date = day("2026-12-04", d);
      for (const id of await run(openDueSeasons, `${date}T00:00:00`)) events.push(`${date} open S${id}`);
      for (const id of await run(markSeasonsClosing, `${date}T21:30:00`)) events.push(`${date} close S${id}`);
    }

    const expected = ["2026-12-06 close S5"];
    for (let id = 6; id <= 18; id++) {
      const week = 7 * (id - 6);
      expected.push(`${day("2026-12-07", week)} open S${id}`, `${day("2026-12-13", week)} close S${id}`);
    }
    expect(events).toEqual(expected);
    expect(events.at(-1)).toBe("2027-03-07 close S18");

    // Each season went on-chain with its own row's IST times: Monday 00:00 to Sunday 21:30.
    expect(chain.opened[5]).toEqual({ n: 5, start: ist("2026-12-04T00:00:00").toISOString(), end: ist("2026-12-06T21:30:00").toISOString() });
    expect(chain.opened[6]).toEqual({ n: 6, start: ist("2026-12-07T00:00:00").toISOString(), end: ist("2026-12-13T21:30:00").toISOString() });

    const { rows } = await pglite.query(
      "select id, kind::text as kind, provisional_min_trades as n, trust_rules_version as rules from seasons where id in (5, 6) order by id",
    );
    expect(rows).toEqual([
      { id: 5, kind: "sprint", n: 8, rules: "trust-v1-sprint" },
      { id: 6, kind: "weekly", n: 20, rules: "trust-v1" },
    ]);
  });
});
