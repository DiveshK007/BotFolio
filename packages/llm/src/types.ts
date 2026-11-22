import type { JsonSchema } from "./schema";

/** SPEC §6.6 interface. The runner only ever sees this, never a provider SDK. */
export interface LlmRequest {
  system: string;
  input: object;
  schema: JsonSchema;
  schemaName: string;
  model: string;
  temperature?: number;
  timeoutMs: number;
}

export interface LlmUsage {
  inTok: number;
  outTok: number;
}

export interface LlmResponse<T> {
  output: T;
  /** Raw text the model returned (logged as `raw_output_json`). */
  raw: string;
  /** Model id the provider reports it used (falls back to the requested id). */
  model: string;
  usage: LlmUsage;
  /** Extra fields beyond SPEC §6.6, for logging: what we actually sent. */
  provider: LlmProvider;
  temperature: number | undefined;
  /** 1 = first try worked, 2 = needed the one retry. */
  attempts: number;
}

export interface LlmClient {
  readonly provider: LlmProvider;
  complete<T>(req: LlmRequest): Promise<LlmResponse<T>>;
}

export type LlmProvider = "xai" | "openai" | "anthropic" | "fake";

/** Why a call failed after its retry. The runner maps every one of these to `status=invalid` → hold. */
export type LlmErrorKind = "timeout" | "invalid_json" | "schema_mismatch" | "http" | "refusal";

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    /** Raw model text, when we got any — still worth logging. */
    readonly raw?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }

  /** SPEC §6.6: one retry on timeout or invalid JSON. Schema mismatch is treated as invalid JSON. 5xx/429 are transient too. */
  get retryable(): boolean {
    if (this.kind === "timeout" || this.kind === "invalid_json" || this.kind === "schema_mismatch") return true;
    if (this.kind === "http") return this.status === undefined || this.status === 429 || this.status >= 500;
    return false;
  }
}
