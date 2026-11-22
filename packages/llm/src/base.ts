import { formatSchemaErrors, validateJson } from "./schema";
import { LlmError, type LlmClient, type LlmProvider, type LlmRequest, type LlmResponse, type LlmUsage } from "./types";

/** What one provider round-trip returns before we parse and validate it. */
export interface RawCompletion {
  raw: string;
  model: string;
  usage: LlmUsage;
}

/**
 * Shared behaviour for every provider (SPEC §6.6):
 * - hard timeout per attempt (AbortController),
 * - parse JSON and re-validate against the schema ourselves (we don't trust "guaranteed" blindly),
 * - exactly one retry on a retryable failure, then throw `LlmError` → the runner sets `status=invalid` and holds.
 */
export abstract class BaseLlmClient implements LlmClient {
  abstract readonly provider: LlmProvider;

  protected abstract callOnce(req: LlmRequest, signal: AbortSignal): Promise<RawCompletion>;

  async complete<T>(req: LlmRequest): Promise<LlmResponse<T>> {
    const maxAttempts = 2;
    let lastError: LlmError | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await this.attempt<T>(req);
        return { ...res, provider: this.provider, temperature: req.temperature, attempts: attempt };
      } catch (e) {
        lastError = toLlmError(e);
        if (!lastError.retryable) break;
      }
    }
    throw lastError!;
  }

  private async attempt<T>(req: LlmRequest): Promise<Omit<LlmResponse<T>, "provider" | "temperature" | "attempts">> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    let completion: RawCompletion;
    try {
      completion = await this.callOnce(req, controller.signal);
    } catch (e) {
      if (controller.signal.aborted) throw new LlmError("timeout", `LLM call timed out after ${req.timeoutMs} ms`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const output = parseAndValidate<T>(req, completion.raw);
    return { output, raw: completion.raw, model: completion.model, usage: completion.usage };
  }
}

export function parseAndValidate<T>(req: Pick<LlmRequest, "schema" | "schemaName">, raw: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LlmError("invalid_json", `${req.schemaName}: model output is not JSON`, raw);
  }
  const errors = validateJson(req.schema, parsed);
  if (errors.length > 0) {
    throw new LlmError("schema_mismatch", `${req.schemaName}: ${formatSchemaErrors(errors)}`, raw);
  }
  return parsed as T;
}

function toLlmError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  // fetch() network failures (DNS, TLS reset) surface as TypeError — treat as transient HTTP.
  const message = e instanceof Error ? e.message : String(e);
  return new LlmError("http", message);
}
