import { readFileSync } from "node:fs";
import { istDay } from "@botfolio/shared";
import { describe, expect, it } from "vitest";
import { JOBS } from "../../src/scheduler/jobs";
import { settleDayFor, slotAt } from "../../src/scheduler/times";

const ist = (time: string, day = "2026-11-24") => new Date(`${day}T${time}+05:30`);
const dayOf = (date: Date) => istDay(Math.floor(date.getTime() / 1000));

describe("JOBS", () => {
  it("has exactly the UTC expressions of SPEC §6.1's table", () => {
    const spec = readFileSync(new URL("../../../../SPEC.md", import.meta.url), "utf8");
    const table = spec.slice(spec.indexOf("### 6.1 Schedule"), spec.indexOf("- Debut decision on"));
    const inSpec = [...table.matchAll(/`([\d*/,-]+ [\d*/,-]+ \* \* \*)`/g)].map((match) => match[1]);
    expect([...JOBS.flatMap((job) => job.crons as readonly string[])].sort()).toEqual(inSpec.sort());
  });
});

describe("slotAt", () => {
  it.each(["09", "13", "17", "21"])("%s:00 IST is a slot with retries at +5, +10 and +15", (hour) => {
    const time = ist(`${hour}:00:00`);
    for (const [minute, attempt] of [["00:00", 0], ["04:59", 0], ["05:00", 1], ["10:00", 2], ["15:00", 3], ["19:59", 3]] as const) {
      expect(slotAt(ist(`${hour}:${minute}`))).toEqual({ time, attempt });
    }
    expect(slotAt(ist(`${hour}:20:00`))).toBeNull();
    expect(slotAt(new Date(time.getTime() - 1))).toBeNull();
  });

  it.each(["00:00:00", "03:30:00", "08:30:00", "12:00:00", "15:30:00", "23:50:00"])("%s IST is no slot", (time) => {
    expect(slotAt(ist(time))).toBeNull();
  });
});

describe("settleDayFor", () => {
  it.each(["21:00:00", "21:10:00", "23:50:00"])("%s IST settles that day", (time) => {
    expect(settleDayFor(ist(time))).toBe(dayOf(ist(time)));
  });

  it("the next 09:00 settles the day before, also across a month", () => {
    expect(settleDayFor(ist("09:00:00"))).toBe(dayOf(ist("21:00:00", "2026-11-23")));
    expect(settleDayFor(ist("09:00:00", "2026-12-01"))).toBe(dayOf(ist("21:00:00", "2026-11-30")));
  });
});
