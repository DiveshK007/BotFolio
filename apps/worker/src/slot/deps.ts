import type { LlmClient, LlmConfig } from "@botfolio/llm";
import type { Address, LocalAccount } from "viem";
import type { BigMoveConfig } from "../config";
import type { HealthState } from "../health";
import type { OracleReading } from "../oracle";
import type { Db } from "../scheduler/db";
import type { Log } from "../scheduler/log";
import type { RunnerChain } from "./chain";

/** The gate's rules. Bump it when gate() or the content filter's lists change, so a replay picks the same ones. */
export const GATE_RULES_VERSION = "gate-v1";

export interface RunnerDeps {
  db: Db;
  chain: RunnerChain;
  readPrices(nowSeconds: number): Promise<OracleReading[]>;
  llm: LlmClient;
  llmConfig: Pick<LlmConfig, "models" | "temperature" | "timeoutMs" | "promptVersion">;
  bigMove: BigMoveConfig;
  /** Signs ApprovedOrders and bot views. The same key sends executeBatch. */
  runner: LocalAccount;
  paperLedger: Address;
  dailyCall: Address;
  health: HealthState;
  log: Log;
  now(): Date;
}
