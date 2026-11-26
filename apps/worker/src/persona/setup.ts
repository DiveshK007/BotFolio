import { createLlmClient } from "@botfolio/llm";
import type { Env } from "../auth/env";
import { errorLabel, type Log } from "../auth/log";
import type { WorkerConfig } from "../config";
import { POOL_MAX } from "../database-url";
import type { HealthState } from "../health";
import { databaseConfig, openDb } from "../relay/db";
import type { PersonaRouteOptions } from "./route";

interface PersonaSetup {
  service: PersonaRouteOptions["service"];
  /** Variable names only. */
  problems: string[];
  stop(): Promise<void>;
}

export function setUpPersona(opts: { env: Env; cfg: WorkerConfig; health: HealthState; log: Log }): PersonaSetup {
  const { env, cfg, health, log } = opts;
  const off = (problems: string[]): PersonaSetup => ({ service: null, problems, stop: async () => {} });

  const problems: string[] = [];
  const database = databaseConfig(env.DATABASE_URL);
  if (!database) problems.push("DATABASE_URL");
  if (cfg.llm.provider === "fake") problems.push("LLM_PROVIDER");
  if (problems.length > 0 || !database) return off(problems);

  try {
    const llm = createLlmClient({ env });
    const db = openDb({ ...database, max: POOL_MAX.persona }, log);
    return { service: { db, llm, config: cfg.llm, health }, problems: [], stop: () => db.close() };
  } catch (error) {
    log("persona.setup_failed", { cause: errorLabel(error) });
    return off([`${cfg.llm.provider.toUpperCase()}_API_KEY`]);
  }
}
