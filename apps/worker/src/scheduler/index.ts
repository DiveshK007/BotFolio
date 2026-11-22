import type { HealthState } from "../health";
import { createPgDb, databaseConfig, type Db, type DatabaseConfig } from "./db";
import { consoleLog, type Log } from "./log";
import { createScheduler, type JobHandlers, type JobSet } from "./scheduler";

type Env = Record<string, string | undefined>;

export interface StartSchedulerOptions {
  health: HealthState;
  handlers?: JobHandlers;
  /** Each module's jobs, built once the database is known to be configured. */
  jobs?: readonly ((deps: { db: Db; log: Log }) => JobSet)[];
  env?: Env;
  log?: Log;
  openDb?: (database: DatabaseConfig, log: Log) => Db;
}

/** Without a database nothing is scheduled. The logs and /healthz say why, and the worker keeps serving. */
export function startScheduler(options: StartSchedulerOptions): { stop(): Promise<void> } | null {
  const { health, handlers = {}, jobs = [], env = process.env, log = consoleLog, openDb = createPgDb } = options;
  const database = databaseConfig(env.DATABASE_URL);
  if (typeof database === "string") {
    health.addStartProblem(`scheduler not started: ${database}`);
    log.warn("scheduler.not_started", { problems: [database] });
    return null;
  }

  const db = openDb(database, log);
  const sets = jobs.map((build) => build({ db, log }));
  const scheduler = createScheduler({
    db,
    handlers: Object.assign({}, handlers, ...sets.map((set) => set.handlers)),
    unavailable: Object.assign({}, ...sets.map((set) => set.unavailable)),
    health,
    log,
  });
  scheduler.start();
  return {
    async stop() {
      await scheduler.stop();
      await db.close();
    },
  };
}
