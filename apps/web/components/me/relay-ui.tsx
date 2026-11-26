"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { Hex } from "viem";
import { ErrorNote, PrimaryButton } from "@/components/create/controls";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import type { OwnerConfig } from "@/lib/config";
import { FlowError, userMessage } from "@/lib/errors";
import { confirmAction, createChainClient, relayAction, type ActionEvent, type LaunchStep, type OwnerAction } from "@/lib/relay-call";
import type { WalletSession } from "@/lib/wallet";

export type RelayPhase =
  | { name: "idle" }
  | { name: "busy"; step: LaunchStep | "confirming" }
  | { name: "done"; txHash: Hex; event: ActionEvent }
  | { name: "error"; message: string; txHash?: Hex; action?: OwnerAction };

export const STEP_TEXT: Record<LaunchStep | "confirming", string> = {
  checking: "Checking QIE…",
  signing: "Confirm with your passkey…",
  relaying: "Sending. We pay the gas…",
  confirming: "Waiting for QIE to confirm…",
};

/**
 * One owner action at a time: relay → receipt. "done" only comes from a mined receipt with the action's own event.
 * A lost or slow answer keeps the tx hash, so "Check again" looks at that tx instead of signing a second one.
 */
export function useRelay(config: OwnerConfig | null, session: WalletSession | null) {
  const [client] = useState(createChainClient);
  const [phase, setPhase] = useState<RelayPhase>({ name: "idle" });

  async function confirm(action: OwnerAction, txHash: Hex): Promise<ActionEvent | null> {
    if (!config) return null;
    setPhase({ name: "busy", step: "confirming" });
    try {
      const event = await confirmAction({ config, client, action, txHash });
      setPhase({ name: "done", txHash, event });
      return event;
    } catch (e) {
      const pending = e instanceof FlowError && e.code === "NOT_CONFIRMED";
      setPhase({ name: "error", message: userMessage(e), txHash, ...(pending && { action }) });
      return null;
    }
  }

  async function run(action: OwnerAction): Promise<ActionEvent | null> {
    if (!config || !session) return null;
    setPhase({ name: "busy", step: "checking" });
    let txHash: Hex;
    try {
      txHash = await relayAction({ config, client, session, action, onStep: (step) => setPhase({ name: "busy", step }) });
    } catch (e) {
      setPhase({ name: "error", message: userMessage(e) });
      return null;
    }
    return confirm(action, txHash);
  }

  const busy = phase.name === "busy";
  const recheck = phase.name === "error" && phase.action && phase.txHash ? () => confirm(phase.action!, phase.txHash!) : undefined;
  return { phase, busy, run, recheck, reset: () => setPhase({ name: "idle" }), fail: (message: string) => setPhase({ name: "error", message }) };
}

/** Progress, error or the explorer link for the user's own signed tx. */
export function ActionStatus({ phase, done, onRecheck }: { phase: RelayPhase; done: ReactNode; onRecheck?: () => void }) {
  if (phase.name === "idle") return null;
  if (phase.name === "busy") {
    return (
      <p role="status" className="text-sm text-muted">
        {STEP_TEXT[phase.step]}
      </p>
    );
  }
  if (phase.name === "done") {
    return (
      <p role="status" className="flex flex-wrap items-center gap-2 text-sm">
        <span>{done}</span>
        <ExplorerLink tx={phase.txHash} label="View on explorer" />
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <ErrorNote>{phase.message}</ErrorNote>
      {phase.txHash && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          Your tx: <ExplorerLink tx={phase.txHash} />
          {onRecheck && (
            <button type="button" onClick={onRecheck} className="min-h-11 font-semibold text-accent-ink">
              Check again
            </button>
          )}
        </p>
      )}
    </div>
  );
}

const card = "rounded-r3 border border-line bg-surface p-4 shadow-card";

/** Sign-in for the owner screens. The button is the passkey trigger (a fresh tap, for iOS). */
export function SignInCard({ available, busy, error, onSignIn, why }: { available: boolean; busy: boolean; error: string | null; onSignIn: () => void; why: string }) {
  if (!available) {
    return (
      <section role="status" className="rounded-r3 border border-line bg-amber-soft p-4">
        <h2 className="font-semibold text-amber">Sign-in isn&apos;t live yet</h2>
        <p className="mt-1 text-sm">Passkey sign-in isn&apos;t switched on on this site yet. Every bot&apos;s public page still works.</p>
        <Link href="/leaderboards" className="mt-2 inline-flex min-h-11 items-center font-semibold text-accent-ink">
          See the leaderboards
        </Link>
      </section>
    );
  }
  return (
    <section className={`${card} flex flex-col gap-3`}>
      <p className="text-sm">{why}</p>
      <PrimaryButton disabled={busy} onClick={onSignIn}>
        {busy ? "Waiting for your passkey…" : "Sign in with passkey"}
      </PrimaryButton>
      <p className="text-center text-xs text-muted">No seed phrase, no gas. You never pay.</p>
      {error && <ErrorNote>{error}</ErrorNote>}
    </section>
  );
}

/** Shown in place of an action whose contract or worker isn't connected yet. */
export function NotLive({ children }: { children: ReactNode }) {
  return <p className="rounded-r2 bg-surface-2 p-3 text-sm text-muted">{children}</p>;
}
