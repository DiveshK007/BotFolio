/** Browser client for the Render service. No retries and no fallbacks: a failure reaches the user as a failure. */
import { RELAY_AUTH_KIND_HEADER, RELAY_PATH, type ForwardRequestJson, type RelayRequestBody } from "@botfolio/shared";
import type { Hex } from "viem";
import { FlowError } from "./errors";
import { parsePersonaDraft, type PersonaDraft } from "./persona";
import type { WalletSession } from "./wallet";

/**
 * UNVERIFIED, a proposal: SPEC names no path or body for the persona call.
 * TODO(#41): align with the worker.
 * POST { sentence, termsAccepted: true } → { ok: true, persona: <§6.3 schema>, personaHash }.
 */
export const PERSONA_PATH = "/persona";

const PERSONA_TIMEOUT_MS = 25_000; // the worker gives the LLM 20 s (LLM_TIMEOUT_MS)
const RELAY_TIMEOUT_MS = 30_000;

type Auth = Pick<WalletSession, "authKind" | "getAuthToken">;

interface Call {
  url: string;
  auth: Auth;
  body: unknown;
  timeoutMs: number;
  /** Shown when no usable answer came back. */
  noAnswer: string;
  signal?: AbortSignal;
}

export async function postJson({ url, auth, body, timeoutMs, noAnswer, signal }: Call): Promise<Record<string, unknown>> {
  const token = await auth.getAuthToken();
  // AbortSignal.any needs iOS 17.4, so join the caller's signal and the timeout by hand.
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, [RELAY_AUTH_KIND_HEADER]: auth.authKind },
      body: JSON.stringify(body),
      credentials: "omit",
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok && json?.ok === true) return json;

    const error = json?.error as { code?: unknown; message?: unknown } | undefined;
    if (json?.ok === false && typeof error?.code === "string" && typeof error.message === "string") {
      throw new FlowError(error.code, error.message.slice(0, 200));
    }
    throw new FlowError("BAD_RESPONSE", noAnswer);
  } catch (e) {
    if (e instanceof FlowError) throw e;
    throw new FlowError("NO_ANSWER", noAnswer);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function requestPersona(
  workerUrl: string,
  auth: Auth,
  sentence: string,
  signal?: AbortSignal,
  dnaSeed?: string,
): Promise<PersonaDraft> {
  const json = await postJson({
    url: workerUrl + PERSONA_PATH,
    auth,
    // termsAccepted lets the worker write users.terms_accepted_at (SPEC §3). Only reachable after the 18+ tick.
    body: { sentence, termsAccepted: true, ...(dnaSeed ? { dnaSeed } : {}) },
    timeoutMs: PERSONA_TIMEOUT_MS,
    noAnswer: "The bot maker isn't responding. Please try again.",
    signal,
  });
  const draft = parsePersonaDraft(json);
  if (!draft) throw new FlowError("BAD_RESPONSE", "The bot maker sent back something broken. Please try again.");
  return draft;
}

/**
 * POST /relay (SPEC §10, §11). A lost answer can mean the tx was sent, so the copy doesn't claim it wasn't.
 * Trying again is safe: the forwarder nonce and one-bot-per-wallet both block a second bot.
 */
export async function postRelay(
  workerUrl: string,
  auth: Auth,
  request: ForwardRequestJson,
  noAnswer = "We couldn't confirm the launch went through. Try again: you can't end up with two bots.",
): Promise<Hex> {
  const body: RelayRequestBody = { request };
  const json = await postJson({ url: workerUrl + RELAY_PATH, auth, body, timeoutMs: RELAY_TIMEOUT_MS, noAnswer });
  if (typeof json.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(json.txHash)) {
    throw new FlowError("BAD_RESPONSE", noAnswer);
  }
  return json.txHash as Hex;
}
