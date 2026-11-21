import { BaseLlmClient, type RawCompletion } from "./base";
import { LlmError, type LlmProvider, type LlmRequest } from "./types";

export interface OpenAiCompatibleOptions {
  apiKey: string;
  baseUrl: string;
  /** Injected in tests so no real HTTP call is ever made. */
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  model?: string;
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Chat Completions client with strict structured output:
 * `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }` (SPEC §6.6).
 * xAI's API is OpenAI-compatible, so `XaiClient` and `OpenAiClient` differ only in base URL and key.
 */
export abstract class OpenAiCompatibleClient extends BaseLlmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenAiCompatibleOptions) {
    super();
    if (!opts.apiKey) throw new Error(`${new.target.name}: API key is missing (set it in the Render env, never in code)`);
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** The exact JSON body we POST. Exposed for tests and for logging the parameters sent. */
  buildBody(req: LlmRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: JSON.stringify(req.input) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: req.schemaName, schema: req.schema, strict: true },
      },
    };
    // UNVERIFIED: whether grok-4.20-0309-non-reasoning honours temperature 0 exactly (SPEC §6.6). We send it and log it.
    if (req.temperature !== undefined) body.temperature = req.temperature;
    return body;
  }

  protected async callOnce(req: LlmRequest, signal: AbortSignal): Promise<RawCompletion> {
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(this.buildBody(req)),
      signal,
    });
    if (!res.ok) {
      // Don't echo the body into logs wholesale; status + a short snippet is enough to debug.
      const text = await res.text().catch(() => "");
      throw new LlmError("http", `${this.provider} HTTP ${res.status}: ${text.slice(0, 200)}`, undefined, res.status);
    }
    const json = (await res.json()) as ChatCompletionResponse;
    const message = json.choices?.[0]?.message;
    if (message?.refusal) throw new LlmError("refusal", `${this.provider} refused: ${message.refusal.slice(0, 200)}`);
    const raw = message?.content;
    if (typeof raw !== "string") throw new LlmError("invalid_json", `${this.provider}: response has no message content`);
    return {
      raw,
      model: json.model ?? req.model,
      usage: { inTok: json.usage?.prompt_tokens ?? 0, outTok: json.usage?.completion_tokens ?? 0 },
    };
  }
}

/** Default provider: Grok via xAI, base URL `https://api.x.ai/v1`, auth `XAI_API_KEY` (SPEC §6.6). */
export class XaiClient extends OpenAiCompatibleClient {
  readonly provider: LlmProvider = "xai";
  constructor(opts: Partial<OpenAiCompatibleOptions> & { apiKey: string }) {
    super({ ...opts, baseUrl: opts.baseUrl || "https://api.x.ai/v1" });
  }
}

/** Swap-in: `LLM_PROVIDER=openai` + `OPENAI_API_KEY`. UNVERIFIED against the live OpenAI API (not exercised yet). */
export class OpenAiClient extends OpenAiCompatibleClient {
  readonly provider: LlmProvider = "openai";
  constructor(opts: Partial<OpenAiCompatibleOptions> & { apiKey: string }) {
    super({ ...opts, baseUrl: opts.baseUrl || "https://api.openai.com/v1" });
  }
}
