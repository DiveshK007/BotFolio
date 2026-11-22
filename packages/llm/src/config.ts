import { AnthropicClient } from "./anthropic";
import { FakeLlmClient, type FakeReply, type FakeResponder } from "./fake";
import { OpenAiClient, XaiClient } from "./openai-compatible";
import type { LlmClient, LlmProvider } from "./types";

type Env = Record<string, string | undefined>;

/** Everything the runner needs to know about the LLM, read from env (SPEC §10 env list). */
export interface LlmConfig {
  provider: LlmProvider;
  models: { decision: string; persona: string; v2: string };
  temperature: number | undefined;
  timeoutMs: number;
  /** `LLM_MONTHLY_BUDGET_USD`; null = not set yet (open decision, SPEC §15 #1). */
  monthlyBudgetUsd: number | null;
  promptVersion: string;
}

const PROVIDERS: readonly LlmProvider[] = ["xai", "openai", "anthropic", "fake"];
// SPEC §6.6 default model. Config, not code: env always wins.
const DEFAULT_MODEL = "grok-4.20-0309-non-reasoning";

export function loadLlmConfig(env: Env = process.env): LlmConfig {
  const provider = (env.LLM_PROVIDER || "xai").toLowerCase() as LlmProvider;
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`LLM_PROVIDER must be one of ${PROVIDERS.join("|")}, got "${env.LLM_PROVIDER}"`);
  }
  const decision = env.LLM_MODEL_DECISION || DEFAULT_MODEL;
  return {
    provider,
    models: {
      decision,
      persona: env.LLM_MODEL_PERSONA || decision,
      v2: env.LLM_MODEL_V2 || decision,
    },
    temperature: optionalNumber(env.LLM_TEMPERATURE, "LLM_TEMPERATURE") ?? 0,
    timeoutMs: optionalNumber(env.LLM_TIMEOUT_MS, "LLM_TIMEOUT_MS") ?? 20_000,
    monthlyBudgetUsd: optionalNumber(env.LLM_MONTHLY_BUDGET_USD, "LLM_MONTHLY_BUDGET_USD") ?? null,
    promptVersion: env.PROMPT_VERSION || "prompt-v1",
  };
}

function optionalNumber(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  return n;
}

export interface CreateLlmClientOptions {
  env?: Env;
  fetchImpl?: typeof fetch;
  /** Only for `LLM_PROVIDER=fake`. Default: always replies "{}" (callers' schemas will reject it → hold). */
  fakeReplies?: FakeResponder | FakeReply[];
}

/** Picks the provider from `LLM_PROVIDER`. Swapping to OpenAI/Anthropic is an env change plus that provider's key. */
export function createLlmClient(opts: CreateLlmClientOptions = {}): LlmClient {
  const env = opts.env ?? process.env;
  const { provider } = loadLlmConfig(env);
  switch (provider) {
    case "xai":
      return new XaiClient({ apiKey: env.XAI_API_KEY ?? "", baseUrl: env.XAI_BASE_URL, fetchImpl: opts.fetchImpl });
    case "openai":
      return new OpenAiClient({ apiKey: env.OPENAI_API_KEY ?? "", fetchImpl: opts.fetchImpl });
    case "anthropic":
      return new AnthropicClient({ apiKey: env.ANTHROPIC_API_KEY ?? "", fetchImpl: opts.fetchImpl });
    case "fake":
      return new FakeLlmClient(opts.fakeReplies ?? ["{}"]);
  }
}
