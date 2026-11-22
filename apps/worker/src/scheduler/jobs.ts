/**
 * SPEC §6.1, word for word. The expressions are UTC (IST = UTC+5:30) and run in UTC whatever TZ says.
 * A job runs only when it has a handler. Until then /healthz lists it as not implemented.
 */
export const JOBS = [
  {
    name: "slot",
    issue: 49,
    // Decision slots at 09:00, 13:00, 17:00, 21:00 IST, then the stale retries at +5, +10, +15 min.
    crons: ["30 3,7,11,15 * * *", "35,40,45 3,7,11,15 * * *"],
  },
  { name: "season_close", issue: 55, crons: ["0 16 * * *"] }, // 21:30 IST
  { name: "season_open", issue: 55, crons: ["30 18 * * *"] }, // 00:00 IST
  { name: "recap", issue: 185, crons: ["5 16 * * *"] }, // 21:35 IST
  {
    name: "daily_call_settle",
    issue: 54,
    // 21:00, every 10 min until 23:50 IST, then once more at the next 09:00.
    crons: ["30,40,50 15 * * *", "*/10 16-17 * * *", "0,10,20 18 * * *", "30 3 * * *"],
  },
  { name: "big_move_sweep", issue: 53, crons: ["*/10 * * * *"] },
] as const satisfies readonly { name: string; issue: number; crons: readonly string[] }[];

export type JobName = (typeof JOBS)[number]["name"];
