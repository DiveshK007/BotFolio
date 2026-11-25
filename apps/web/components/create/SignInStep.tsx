"use client";

import Link from "next/link";
import { useState } from "react";
import { PrimaryButton } from "./controls";

interface SignInStepProps {
  /** Why sign-in can't work right now, or null when it can. */
  blocked: string | null;
  busy: boolean;
  onSignIn: () => void;
}

/**
 * Sign-up with the one-line 18+ confirmation (SPEC §11). Unticked by default: it has to be the user's own tap.
 * The button is the passkey trigger, because WebAuthn needs a fresh tap on iOS.
 */
export function SignInStep({ blocked, busy, onSignIn }: SignInStepProps) {
  const [confirmed, setConfirmed] = useState(false);

  if (blocked) {
    return (
      <section role="status" className="rounded-r3 border border-line bg-amber-soft p-4">
        <h2 className="font-semibold text-amber">Bot creation isn&apos;t live yet</h2>
        <p className="mt-1 text-sm">{blocked}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2 rounded-r3 border border-line bg-surface p-4 shadow-card">
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="size-5 shrink-0 accent-accent"
        />
        <span>
          I&apos;m 18+ and accept the{" "}
          {/* New tab, so reading the terms doesn't lose the bot card. */}
          <Link href="/terms" target="_blank" rel="noopener" className="font-semibold text-accent-ink underline">
            Terms of use
          </Link>
          .
        </span>
      </label>
      <PrimaryButton disabled={!confirmed || busy} onClick={onSignIn}>
        {busy ? "Waiting for your passkey…" : "Continue with passkey"}
      </PrimaryButton>
      <p className="text-center text-xs text-muted">No seed phrase, no gas. You never pay.</p>
    </section>
  );
}
