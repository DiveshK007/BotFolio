import type { HealthState } from "../health";
import { createPgDb, databaseConfig, type Db, type DatabaseConfig } from "./db";
import { consoleLog, type Log } from "./log";
import { createScheduler, type JobHandlers } from "./scheduler";

type Env = Record<string, string | undefined>;

export interface StartSchedulerOptions {
  health: HealthState;
  handlers?: JobHandlers;
  env?: Env;
  log?: Log;
  openDb?: (database: DatabaseConfig, log: Log) => Db;
}

/** Without a database nothing is scheduled. The logs and /healthz say why, and the worker keeps serving. */
export function startScheduler(options: StartSchedulerOptions): { stop(): Promise<void> } | null {
  const { health, handlers = {}, env = process.env, log = consoleLog, openDb = createPgDb } = options;
  const database = databaseConfig(env.DATABASE_URL);
  if (typeof database === "string") {
    health.addStartProblem(`scheduler not started: ${database}`);
    log.warn("scheduler.not_started", { problems: [database] });
    return null;
  }

  const db = openDb(database, log);
  const scheduler = createScheduler({ db, handlers, health, log });
  scheduler.start();
  return {
    async stop() {
      await scheduler.stop();
      await db.close();
    },
  };
}
