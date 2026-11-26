import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../../../packages/db/${path}`, import.meta.url), "utf8");
const SEED = read("seeds/seasons.sql");

interface Season {
  id: number;
  opens: string;
  closes: string;
  kind: string;
  min_trades: number;
  rules: string;
}

const SELECT = `
  select id,
         to_char(starts_at at time zone 'Asia/Kolkata', 'Dy YYYY-MM-DD HH24:MI') as opens,
         to_char(ends_at at time zone 'Asia/Kolkata', 'Dy YYYY-MM-DD HH24:MI') as closes,
         kind::text as kind, provisional_min_trades as min_trades, trust_rules_version as rules
  from seasons order by id`;

// A DST zone on purpose: the seed must give the same instants whatever the session's time zone is.
describe.each(["UTC", "America/New_York", "Asia/Kolkata"])("seeds/seasons.sql in a %s session", (zone) => {
  let db: PGlite;
  let seasons: Season[];

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(read("schema.sql"));
    await db.exec(`set time zone '${zone}'`);
    await db.exec(SEED);
    seasons = (await db.query<Season>(SELECT)).rows;
  }, 30_000);
  afterAll(() => db.close());

  it("S0-S5 are exactly SPEC §1's table", () => {
    const sprint = { kind: "sprint", min_trades: 8, rules: "trust-v1-sprint" };
    expect(seasons.slice(0, 6)).toEqual([
      { id: 0, opens: "Fri 2026-11-27 00:00", closes: "Sat 2026-11-28 21:30", ...sprint },
      { id: 1, opens: "Sun 2026-11-29 00:00", closes: "Mon 2026-11-30 21:30", ...sprint },
      { id: 2, opens: "Tue 2026-12-01 00:00", closes: "Wed 2026-12-02 21:30", ...sprint },
      { id: 3, opens: "Thu 2026-12-03 00:00", closes: "Fri 2026-12-04 21:30", ...sprint },
      { id: 4, opens: "Sat 2026-12-05 00:00", closes: "Sun 2026-12-06 21:30", ...sprint },
      { id: 5, opens: "Mon 2026-12-07 00:00", closes: "Sun 2026-12-13 21:30", kind: "weekly", min_trades: 20, rules: "trust-v1" },
    ]);
  });

  it("runs weekly, with no gap, through the week that holds Mar 10", () => {
    expect(seasons.map((s) => s.id)).toEqual(Array.from({ length: 19 }, (_, id) => id));
    for (const s of seasons.slice(5)) {
      expect(s).toMatchObject({ kind: "weekly", min_trades: 20, rules: "trust-v1" });
      expect(s.opens).toMatch(/^Mon .* 00:00$/);
      expect(s.closes).toMatch(/^Sun .* 21:30$/);
    }
    expect(seasons.at(-1)).toMatchObject({ opens: "Mon 2027-03-08 00:00", closes: "Sun 2027-03-14 21:30" });
  });

  it("every season's last 21:00 slot is inside it, and no two seasons overlap", async () => {
    const { rows } = await db.query(`
      select a.id from seasons a
      where a.ends_at - interval '30 minutes' < a.starts_at
         or exists (select 1 from seasons b where b.id > a.id and b.starts_at < a.ends_at)`);
    expect(rows).toEqual([]);
  });

  it("running it again changes nothing the worker wrote", async () => {
    await db.exec("update seasons set status = 'closed', data_uri = 'kept' where id = 0");
    await db.exec(SEED);
    const { rows } = await db.query("select status::text as status, data_uri from seasons where id = 0");
    expect(rows).toEqual([{ status: "closed", data_uri: "kept" }]);
    expect((await db.query<Season>(SELECT)).rows).toEqual(seasons);
  });

  it("moves a season nothing has used yet onto the new calendar, and keeps one in use", async () => {
    // A database seeded with the pre-Nov 26 calendar: S0 from Nov 24, and an S19.
    await db.exec(`
      update seasons set starts_at = '2026-11-24 00:00:00+05:30', ends_at = '2026-11-25 21:30:00+05:30' where id in (0, 1);
      insert into seasons (id, starts_at, ends_at, kind, provisional_min_trades)
        values (19, '2027-03-15 00:00:00+05:30', '2027-03-21 21:30:00+05:30', 'weekly', 20);
      insert into slots (slot_time, kind, season_id) values ('2026-11-24 09:00:00+05:30', 'scheduled', 1);`);
    await db.exec(SEED);
    const after = (await db.query<Season>(SELECT)).rows;
    expect(after[0]).toEqual(seasons[0]);
    expect(after[1]).toMatchObject({ opens: "Tue 2026-11-24 00:00" }); // has a slot, so the worker owns it
    expect(after.map((s) => s.id)).toEqual(seasons.map((s) => s.id));
  });
});
