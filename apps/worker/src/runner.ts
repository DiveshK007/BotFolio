/**
 * Side-effect-free entry point for the runner's pure logic: `@botfolio/worker/runner`.
 * The scheduler and the replay script import from here; `src/index.ts` starts the service.
 */
export { gate } from "./gate/gate";
export { applyTrade, portfolioValueE8, tradesTodayFrom } from "./gate/ledger-math";
export * from "./gate/types";
export { DECISION_OUTPUT_SCHEMA, DECISION_SCHEMA, type DecisionOutput } from "./decision/schema";
export { orderIdOf, SKIP_REASONS, type LedgerOrder, type SkipReason } from "./interfaces";
