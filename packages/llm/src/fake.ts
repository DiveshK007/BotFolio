import { BaseLlmClient, type RawCompletion } from "./base";
import type { LlmProvider, LlmRequest } from "./types";

/**
 * One scripted reply. An object is JSON-encoded; a string is returned as the raw text (so tests can
 * send broken JSON); `{ hang: true }` never resolves (to test the timeout); an Error is thrown.
 */
export type FakeReply = object | string | { hang: true } | Error;

export type FakeResponder = (req: LlmRequest, callIndex: number) => FakeReply;

/**
 * Deterministic LLM for tests and local runs (`LLM_PROVIDER=fake`). It goes through the same
 * parse → validate → one-retry path as the real clients, so tests exercise the real logic.
 * It never touches the network.
 */
export class FakeLlmClient extends BaseLlmClient {
  readonly provider: LlmProvider = "fake";
  readonly calls: LlmRequest[] = [];
  private readonly responder: FakeResponder;

  /** Pass a function, or a list of replies used in order (the last one repeats). */
  constructor(replies: FakeResponder | FakeReply[]) {
    super();
    if (typeof replies === "function") {
      this.responder = replies;
    } else {
      if (replies.length === 0) throw new Error("FakeLlmClient: give at least one reply");
      this.responder = (_req, i) => replies[Math.min(i, replies.length - 1)]!;
    }
  }

  protected callOnce(req: LlmRequest, signal: AbortSignal): Promise<RawCompletion> {
    const reply = this.responder(req, this.calls.length);
    this.calls.push(req);
    if (reply instanceof Error) return Promise.reject(reply);
    if (typeof reply === "object" && reply !== null && "hang" in reply && reply.hang === true) {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    const raw = typeof reply === "string" ? reply : JSON.stringify(reply);
    // Deterministic pseudo token counts so cost tracking has something to add up.
    const inTok = Math.ceil((req.system.length + JSON.stringify(req.input).length) / 4);
    const outTok = Math.ceil(raw.length / 4);
    return Promise.resolve({ raw, model: req.model, usage: { inTok, outTok } });
  }
}
