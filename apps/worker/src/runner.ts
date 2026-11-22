/**
 * Side-effect-free entry point for the runner's pure logic: `@botfolio/worker/runner`.
 * The scheduler and the replay script import from here; `src/index.ts` starts the service.
 */
export { loadBigMoveConfig, type BigMoveConfig } from "./config";
export { gate } from "./gate/gate";
export { filterOutput } from "./gate/filter-output";
export { shrinkBigMove, type ShrinkInput, type ShrinkResult } from "./gate/shrink";
export { signApprovedOrder, signDailyCallView } from "./signing";
export { applyTrade, portfolioValueE8, tradesTodayFrom } from "./gate/ledger-math";
export { canonicalJson, hashJson } from "./canonical";
export { bannedRules, type BannedRule } from "./text/content-filter";
export { clampLimits, createPersona, type BotLimits, type Persona, type PersonaResult } from "./persona/persona";
export { PERSONA_SCHEMA } from "./persona/schema";
export * from "./gate/types";
export { runDecisionCall, wantsDailyCall, type DecisionCallResult, type DecisionLog } from "./decision/call";
export { buildDecisionInput, type DecisionContext, type DecisionInput } from "./decision/input";
export { decisionPrompt } from "./decision/prompt";
export { DECISION_OUTPUT_SCHEMA, DECISION_SCHEMA, type DecisionOutput } from "./decision/schema";
export { orderIdOf, SKIP_REASONS, type ApprovedOrder, type LedgerOrder, type SkipReason } from "./interfaces";
