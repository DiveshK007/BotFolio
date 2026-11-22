# packages/llm — WS B (Runner)
`LlmClient` interface + `XaiClient` (strict json_schema output), swappable to OpenAI/Anthropic by `LLM_PROVIDER` (SPEC §6.6).

## Use
```ts
import { createLlmClient, loadLlmConfig } from "@botfolio/llm";
const cfg = loadLlmConfig();          // LLM_PROVIDER, LLM_MODEL_*, LLM_TEMPERATURE, LLM_TIMEOUT_MS, LLM_MONTHLY_BUDGET_USD
const llm = createLlmClient();        // xai (default) | openai | anthropic | fake
const res = await llm.complete<MyType>({ system, input, schema, schemaName: "decision_v1", model: cfg.models.decision, temperature: cfg.temperature, timeoutMs: cfg.timeoutMs });
// res.output (validated), res.raw, res.model, res.usage, res.attempts, res.temperature
```

## Behaviour
- **Strict structured output.** xAI/OpenAI get `response_format: {type: "json_schema", json_schema: {name, schema, strict: true}}`. Anthropic gets one forced tool call whose `input_schema` is the schema.
- **We re-validate anyway** with a tiny validator for the JSON Schema subset we use (`src/schema.ts`). Unknown keywords throw, so a schema can't silently drift from what we check. The replay script can reuse the same check.
- **Timeout + one retry.** Each attempt is aborted after `timeoutMs` (20 s default). Timeouts, invalid JSON, schema mismatches, network errors, 429 and 5xx get exactly one retry. After that, `LlmError` is thrown and the runner records `status=invalid` → hold.
- **Budget.** `estimateCostUsd()` + `budgetState()` implement the 80 % alert / 100 % "bot resting" rule. The cap comes only from `LLM_MONTHLY_BUDGET_USD` (open decision, SPEC §15); unset = `uncapped`. Prices are the SPEC §6.6 numbers (UNVERIFIED against the live pricing page).
- **Tests never call a real API.** `FakeLlmClient` is deterministic and goes through the same parse/validate/retry path; HTTP clients take an injected `fetchImpl`.

UNVERIFIED: the OpenAI and Anthropic paths have only been tested against mocked responses; whether the default Grok model honours `temperature: 0` exactly (we send and log it either way).
