import { BaseLlmClient, type RawCompletion } from "./base";
import { LlmError, type LlmProvider, type LlmRequest } from "./types";

export interface AnthropicOptions {
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

interface MessagesResponse {
  model?: string;
  content?: { type: string; name?: string; input?: unknown }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Swap-in: `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`, models set via `LLM_MODEL_*`.
 * Structured output is done with one forced tool call: the schema is the tool's `input_schema`
 * and `tool_choice` names that tool, so the reply is the tool input JSON. We still re-validate it.
 * UNVERIFIED against the live Anthropic API (not exercised yet).
 */
export class AnthropicClient extends BaseLlmClient {
  readonly provider: LlmProvider = "anthropic";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxTokens: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AnthropicOptions) {
    super();
    if (!opts.apiKey) throw new Error("AnthropicClient: API key is missing (set it in the Render env, never in code)");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "");
    this.maxTokens = opts.maxTokens ?? 1024;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  buildBody(req: LlmRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: this.maxTokens,
      system: req.system,
      messages: [{ role: "user", content: JSON.stringify(req.input) }],
      tools: [{ name: req.schemaName, description: `Return the ${req.schemaName} object.`, input_schema: req.schema }],
      tool_choice: { type: "tool", name: req.schemaName },
      // Built for claude-haiku-5-5 (Nov 26 2026): thinking is on by default there, and a forced tool call
      // needs it off; off is allowed at the default effort. Opus 5.5 / Sonnet 5.5 reject both forced tools
      // and disabled thinking, so they would need structured outputs instead.
      thinking: { type: "disabled" },
    };
    // Current Claude models reject a non-default temperature, so it is only sent when LLM_TEMPERATURE is set.
    if (req.temperature !== undefined) body.temperature = req.temperature;
    return body;
  }

  protected async callOnce(req: LlmRequest, signal: AbortSignal): Promise<RawCompletion> {
    const res = await this.fetchImpl(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(this.buildBody(req)),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LlmError("http", `anthropic HTTP ${res.status}: ${text.slice(0, 200)}`, undefined, res.status);
    }
    const json = (await res.json()) as MessagesResponse;
    const block = json.content?.find((c) => c.type === "tool_use" && c.name === req.schemaName);
    if (!block) throw new LlmError("invalid_json", "anthropic: response has no tool_use block");
    return {
      raw: JSON.stringify(block.input),
      model: json.model ?? req.model,
      usage: { inTok: json.usage?.input_tokens ?? 0, outTok: json.usage?.output_tokens ?? 0 },
    };
  }
}
