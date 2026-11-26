"use client";

/**
 * Minimal stand-in for the wallet PR's useSession() (#71): wraps getWallet() and keeps the session for the
 * life of the tab, so moving between /me, /season and /challenge doesn't ask for the passkey again.
 * shortcut: one module-level session, no sign-out or expiry; swap for useSession() when #71 lands.
 */
import { useState } from "react";
import { userMessage } from "./errors";
import { getWallet, type WalletSession } from "./wallet";

let kept: WalletSession | null = null;

export function useOwnerSession() {
  const [wallet] = useState(getWallet);
  const [session, setSession] = useState<WalletSession | null>(kept);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Call straight from a tap: WebAuthn needs a user gesture on iOS Safari. */
  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      kept = await wallet.signIn();
      setSession(kept);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return { available: wallet.available, session, busy, error, signIn };
}
