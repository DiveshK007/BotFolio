"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PrimaryButton } from "./controls";

export type SignInKind = "passkey" | "qie";

export const SLOW_PASSKEY_MS = 12_000;
export const SLOW_PASSKEY_TEXT = "Creating a passkey the first time can take up to a minute.";

/** Mount while the passkey sheet is open: after 12 s it says the wait is normal (Android took ~60 s, #93). */
export function SlowPasskeyNote() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_PASSKEY_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <p role="status" className="text-center text-xs text-muted">
      {slow ? SLOW_PASSKEY_TEXT : ""}
    </p>
  );
}

interface SignInStepProps {
  /** Why sign-in can't work right now, or null when it can. */
  blocked: string | null;
  /** Which sign-in is open, or null. */
  busy: SignInKind | null;
  /** What this device offers: passkey needs NEXT_PUBLIC_PRIVY_APP_ID, QIE Wallet needs an injected wallet. */
  options: Record<SignInKind, boolean>;
  onSignIn: (kind: SignInKind) => void;
}

/**
 * Sign-up with the one-line 18+ confirmation (SPEC §11). Unticked by default: it has to be the user's own tap.
 * The button is the passkey trigger, because WebAuthn needs a fresh tap on iOS.
 */
export function SignInStep({ blocked, busy, options, onSignIn }: SignInStepProps) {
  const [confirmed, setConfirmed] = useState(false);

  if (blocked) {
    return (
      <section role="status" className="rounded-r3 border border-line bg-amber-soft p-4">
        <h2 className="font-semibold text-amber">Bot creation isn&apos;t live yet</h2>
        <p className="mt-1 text-sm">{blocked}</p>
      </section>
    );
  }

  const locked = !confirmed || busy !== null;
  return (
    <section className="flex flex-col gap-2 rounded-r3 border border-line bg-surface p-4 shadow-card">
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy !== null}
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
      {options.passkey && (
        <>
          <PrimaryButton disabled={locked} onClick={() => onSignIn("passkey")}>
            {busy === "passkey" ? "Waiting for your passkey…" : "Continue with passkey"}
          </PrimaryButton>
          {busy === "passkey" && <SlowPasskeyNote />}
          <p className="text-center text-xs text-muted">New here? This creates your account with Face ID or your fingerprint.</p>
        </>
      )}
      {options.qie && (
        <>
          <button
            type="button"
            disabled={locked}
            onClick={() => onSignIn("qie")}
            className="inline-flex h-12 w-full items-center justify-center rounded-full border border-line bg-surface px-6 font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "qie" ? "Check your wallet…" : "Connect QIE Wallet"}
          </button>
          {/* SPEC §2.6: QIE Wallet's EIP-712 signature on chain 1990 is still untested (#189). */}
          <p className="text-center text-xs text-muted">Or any browser wallet. QIE Wallet signing on QIE mainnet is still being tested.</p>
        </>
      )}
      <p className="text-center text-xs text-muted">No seed phrase, no gas. You never pay.</p>
      <p className="text-center text-xs text-muted">
        We keep your wallet address and login ID, not your email.{" "}
        <Link href="/privacy" target="_blank" rel="noopener" className="underline">
          Privacy policy
        </Link>
      </p>
    </section>
  );
}
