import { describe, expect, it, vi } from "vitest";
import {
  AnthropicClient,
  FakeLlmClient,
  LlmError,
  XaiClient,
  budgetState,
  createLlmClient,
  estimateCostUsd,
  loadLlmConfig,
  type JsonSchema,
  type LlmRequest,
} from "../src";

const schema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer"],
  properties: { answer: { type: "integer", minimum: 0, maximum: 10 } },
};

const req: LlmRequest = {
  system: "You answer with a number.",
  input: { q: "2+2" },
  schema,
  schemaName: "answer_v1",
  model: "grok-4.20-0309-non-reasoning",
  temperature: 0,
  timeoutMs: 50,
};

function chatResponse(content: string, status = 200) {
  return new Response(
    JSON.stringify({
      model: "grok-4.20-0309-non-reasoning",
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 120, completion_tokens: 8 },
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

describe("XaiClient", () => {
  it("sends strict json_schema structured output and parses the reply", async () => {
    const fetchImpl = vi.fn(async () => chatResponse('{"answer":4}'));
    const client = new XaiClient({ apiKey: "test-key", fetchImpl });
    const res = await client.complete<{ answer: number }>(req);

    expect(res.output).toEqual({ answer: 4 });
    expect(res.usage).toEqual({ inTok: 120, outTok: 8 });
    expect(res.attempts).toBe(1);
    expect(res.temperature).toBe(0);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    const body = JSON.parse(init.body as string);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "answer_v1", schema, strict: true },
    });
    expect(body.temperature).toBe(0);
    expect(body.messages[1]).toEqual({ role: "user", content: '{"q":"2+2"}' });
  });

  it("retries once on invalid JSON, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(chatResponse("not json"))
      .mockResolvedValueOnce(chatResponse('{"answer":4}'));
    const res = await new XaiClient({ apiKey: "k", fetchImpl }).complete(req);
    expect(res.attempts).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up after one retry with a schema mismatch", async () => {
    const fetchImpl = vi.fn(async () => chatResponse('{"answer":99}'));
    const err = await new XaiClient({ apiKey: "k", fetchImpl }).complete(req).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.kind).toBe("schema_mismatch");
    expect(err.raw).toBe('{"answer":99}');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad schema", { status: 400 }));
    const err = await new XaiClient({ apiKey: "k", fetchImpl }).complete(req).catch((e) => e);
    expect(err.kind).toBe("http");
    expect(err.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses to start without a key", () => {
    expect(() => new XaiClient({ apiKey: "" })).toThrow(/API key is missing/);
  });

  it("honours XAI_BASE_URL", async () => {
    const fetchImpl = vi.fn(async () => chatResponse('{"answer":1}'));
    await new XaiClient({ apiKey: "k", baseUrl: "http://localhost:9999/v1/", fetchImpl }).complete(req);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("http://localhost:9999/v1/chat/completions");
  });
});

describe("AnthropicClient", () => {
  it("forces one tool call and reads its input as the output", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "some-claude-model",
            content: [{ type: "tool_use", name: "answer_v1", input: { answer: 4 } }],
            usage: { input_tokens: 50, output_tokens: 5 },
          }),
        ),
    );
    const res = await new AnthropicClient({ apiKey: "k", fetchImpl }).complete<{ answer: number }>({ ...req, model: "some-claude-model" });
    expect(res.output).toEqual({ answer: 4 });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.tool_choice).toEqual({ type: "tool", name: "answer_v1" });
    expect(body.tools[0].input_schema).toEqual(schema);
  });
});

describe("FakeLlmClient", () => {
  it("is deterministic and validates like a real client", async () => {
    const fake = new FakeLlmClient([{ answer: 7 }]);
    const a = await fake.complete(req);
    const b = await fake.complete(req);
    expect(a).toEqual(b);
    expect(fake.calls).toHaveLength(2);
  });

  it("times out a hanging call, retries once, then throws timeout", async () => {
    const fake = new FakeLlmClient([{ hang: true }]);
    const err = await fake.complete(req).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.kind).toBe("timeout");
    expect(fake.calls).toHaveLength(2);
  });

  it("recovers when the retry is good", async () => {
    const fake = new FakeLlmClient([{ hang: true }, { answer: 3 }]);
    const res = await fake.complete<{ answer: number }>(req);
    expect(res.output.answer).toBe(3);
    expect(res.attempts).toBe(2);
  });
});

describe("config + factory", () => {
  it("defaults to xai and the SPEC default model", () => {
    const cfg = loadLlmConfig({});
    expect(cfg.provider).toBe("xai");
    expect(cfg.models.decision).toBe("grok-4.20-0309-non-reasoning");
    expect(cfg.timeoutMs).toBe(20_000);
    expect(cfg.temperature).toBe(0);
    expect(cfg.monthlyBudgetUsd).toBeNull();
  });

  it("selects the provider from LLM_PROVIDER", () => {
    expect(createLlmClient({ env: { LLM_PROVIDER: "xai", XAI_API_KEY: "k" } }).provider).toBe("xai");
    expect(createLlmClient({ env: { LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" } }).provider).toBe("openai");
    expect(createLlmClient({ env: { LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" } }).provider).toBe("anthropic");
    expect(createLlmClient({ env: { LLM_PROVIDER: "fake" } }).provider).toBe("fake");
  });

  it("rejects an unknown provider", () => {
    expect(() => loadLlmConfig({ LLM_PROVIDER: "gemini" })).toThrow(/LLM_PROVIDER/);
  });

  it("reads the budget cap only from env", () => {
    expect(loadLlmConfig({ LLM_MONTHLY_BUDGET_USD: "40" }).monthlyBudgetUsd).toBe(40);
  });
});

describe("budget", () => {
  it("prices a decision roughly like SPEC §6.6 (~$0.0023)", () => {
    const usd = estimateCostUsd("grok-4.20-0309-non-reasoning", { inTok: 1500, outTok: 150 });
    expect(usd).toBeCloseTo(0.00225, 6);
  });

  it("charges unknown models at the most expensive known rate", () => {
    expect(estimateCostUsd("mystery", { inTok: 1_000_000, outTok: 0 })).toBe(2);
  });

  it("alerts at 80 % and rests at 100 %", () => {
    expect(budgetState(10, null)).toBe("uncapped");
    expect(budgetState(79, 100)).toBe("ok");
    expect(budgetState(80, 100)).toBe("alert");
    expect(budgetState(100, 100)).toBe("resting");
  });
});
