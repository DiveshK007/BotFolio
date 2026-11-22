"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { getCreateConfig } from "@/lib/config";
import type { LaunchStep } from "@/lib/create-bot";
import { readDraft } from "@/lib/draft";
import { FlowError, userMessage } from "@/lib/errors";
import type { BotLimits, PersonaDraft } from "@/lib/persona";
import { checkSentence } from "@/lib/sentence";
import { getWallet, type WalletSession } from "@/lib/wallet";
import { requestPersona } from "@/lib/worker";
import { LimitSliders } from "./LimitSliders";
import { PersonaCard } from "./PersonaCard";
import { SignInStep } from "./SignInStep";
import { ErrorNote, PrimaryButton } from "./controls";

/**
 * S2 (SPEC §2.1 steps 2–4):
 *
 *   signin → persona → review → launching → confirming → done
 *               ↺         ↑ any launch failure   ↺ still unconfirmed: check the same tx again
 *
 * "done" is only reachable from a verified on-chain receipt.
 */
type Phase =
  | { name: "signin"; busy: boolean }
  | { name: "persona"; busy: boolean }
  | { name: "review" }
  | { name: "launching"; step: LaunchStep }
  | { name: "confirming"; busy: boolean; txHash: Hex }
  | { name: "done"; botId: bigint; txHash: Hex };

const STEP_TEXT: Record<LaunchStep, string> = {
  checking: "Checking QIE…",
  signing: "Confirm with your passkey…",
  relaying: "Launching. We pay the gas…",
};

const SLOW_PERSONA_MS = 5_000; // SPEC §2.1 target for the persona call

function PersonaLoading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_PERSONA_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div role="status" className="rounded-r3 border border-line bg-surface p-4 shadow-card">
      <div aria-hidden="true" className="flex animate-pulse items-center gap-3">
        <span className="size-14 rounded-r2 bg-surface-2" />
        <span className="h-6 w-2/3 rounded-r1 bg-surface-2" />
      </div>
      <p className="mt-3 text-sm text-muted">{slow ? "Still working. This is taking longer than usual…" : "Giving your bot a personality…"}</p>
    </div>
  );
}

export function CreateFlow() {
  const [config] = useState(getCreateConfig);
  const [wallet] = useState(getWallet);
  // undefined until mounted (sessionStorage is browser-only), null when there's no usable sentence.
  const [sentence, setSentence] = useState<string | null>();
  const [session, setSession] = useState<WalletSession>();
  const [draft, setDraft] = useState<PersonaDraft>();
  const [limits, setLimits] = useState<BotLimits>();
  const [phase, setPhase] = useState<Phase>({ name: "signin", busy: false });
  const [error, setError] = useState<string | null>(null);
  const personaCall = useRef<AbortController | null>(null);

  useEffect(() => {
    const check = checkSentence(readDraft()); // storage is editable, so check again
    setSentence(check.ok ? check.value : null);
    return () => personaCall.current?.abort();
  }, []);

  async function loadPersona(signedIn: WalletSession, text: string) {
    if (!config) return;
    setError(null);
    setPhase({ name: "persona", busy: true });
    const call = new AbortController();
    personaCall.current = call;
    try {
      const result = await requestPersona(config.workerUrl, signedIn, text, call.signal);
      setDraft(result);
      setLimits(result.persona.limits);
      setPhase({ name: "review" });
    } catch (e) {
      if (call.signal.aborted) return; // left the page
      setError(userMessage(e));
      setPhase({ name: "persona", busy: false });
    }
  }

  async function signIn() {
    if (!sentence) return;
    setError(null);
    setPhase({ name: "signin", busy: true });
    try {
      const signedIn = await wallet.signIn();
      setSession(signedIn);
      await loadPersona(signedIn, sentence);
    } catch (e) {
      setError(userMessage(e));
      setPhase({ name: "signin", busy: false });
    }
  }

  async function confirm(txHash: Hex) {
    if (!config || !session || !draft) return;
    setError(null);
    setPhase({ name: "confirming", busy: true, txHash });
    try {
      const { confirmBot, createChainClient } = await import("@/lib/create-bot");
      const botId = await confirmBot({
        config,
        client: createChainClient(),
        owner: session.address,
        personaHash: draft.personaHash,
        txHash,
      });
      setPhase({ name: "done", botId, txHash });
    } catch (e) {
      setError(userMessage(e));
      // Only a definite on-chain "no" may go back to Launch. Otherwise keep the hash and re-check that tx.
      const failed = e instanceof FlowError && (e.code === "REVERTED" || e.code === "NO_EVENT");
      setPhase(failed ? { name: "review" } : { name: "confirming", busy: false, txHash });
    }
  }

  async function launch() {
    if (!config || !session || !draft || !limits) return;
    setError(null);
    setPhase({ name: "launching", step: "checking" });
    try {
      const { createChainClient, launchBot } = await import("@/lib/create-bot");
      const txHash = await launchBot({
        config,
        client: createChainClient(),
        session,
        personaHash: draft.personaHash,
        limits,
        onStep: (step) => setPhase({ name: "launching", step }),
      });
      await confirm(txHash);
    } catch (e) {
      setError(userMessage(e));
      setPhase({ name: "review" });
    }
  }

  if (sentence === undefined) {
    return (
      <p role="status" className="text-sm text-muted">
        Loading…
      </p>
    );
  }

  if (sentence === null) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">No bot yet</h1>
        <p className="text-muted">Start by describing your bot in one sentence.</p>
        <Link href="/" className="inline-flex h-12 items-center justify-center rounded-full bg-accent px-6 font-semibold text-on-accent">
          Describe your bot
        </Link>
      </div>
    );
  }

  if (phase.name === "done") {
    return (
      <div role="status" className="flex flex-col gap-4">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Your bot is on QIE</h1>
        {draft && <PersonaCard persona={draft.persona} />}
        <p className="text-sm">Bot #{phase.botId.toString()} was created on QIE mainnet.</p>
        <p>
          <ExplorerLink tx={phase.txHash} label="View on explorer" />
        </p>
      </div>
    );
  }

  let blocked: string | null = null;
  if (!config) blocked = "BotFolio's contracts and relayer aren't connected to this site yet.";
  else if (!wallet.available) blocked = "Passkey sign-in isn't switched on yet.";

  const canEdit = phase.name === "signin" || phase.name === "persona" || phase.name === "review";
  const launching = phase.name === "launching";
  const confirming = phase.name === "confirming";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl font-extrabold tracking-tight">{draft ? "Meet your bot" : "Make your bot"}</h1>

      <div className="flex items-start justify-between gap-3 rounded-r2 bg-surface-2 px-3 py-1.5 text-sm">
        <p className="min-w-0 py-2.5 [overflow-wrap:anywhere]">
          <span className="sr-only">Your sentence: </span>
          <bdi>{sentence}</bdi>
        </p>
        {canEdit && (
          <Link href="/" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center font-semibold text-accent-ink">
            Edit
          </Link>
        )}
      </div>

      {phase.name === "signin" && <SignInStep blocked={blocked} busy={phase.busy} onSignIn={signIn} />}
      {phase.name === "persona" && phase.busy && <PersonaLoading />}

      {draft && limits && (
        <>
          <PersonaCard persona={draft.persona} />
          <LimitSliders limits={limits} disabled={phase.name !== "review"} onChange={setLimits} />
          {/* SPEC §4.2: the UI states that createBot authorises the runner to trade. */}
          <p className="text-sm text-muted">
            <b className="text-ink">Your bot trades automatically.</b> By tapping Launch you allow BotFolio&apos;s runner to trade its play
            money within these limits.
          </p>
        </>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      {phase.name === "persona" && !phase.busy && session && (
        <PrimaryButton onClick={() => loadPersona(session, sentence)}>Try again</PrimaryButton>
      )}
      {(phase.name === "review" || launching) && (
        <PrimaryButton disabled={launching} onClick={launch}>
          <span role="status">{launching ? STEP_TEXT[phase.step] : "Launch"}</span>
        </PrimaryButton>
      )}
      {confirming && (
        <div role="status" className="flex flex-col gap-3">
          {phase.busy ? (
            <p className="text-sm">Waiting for QIE to confirm…</p>
          ) : (
            <PrimaryButton onClick={() => confirm(phase.txHash)}>Check again</PrimaryButton>
          )}
          <p>
            <ExplorerLink tx={phase.txHash} label="View transaction" />
          </p>
        </div>
      )}
    </div>
  );
}
