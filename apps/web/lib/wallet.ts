import type { forwardRequestTypedData, RelayAuthKind } from "@botfolio/shared";
import { useSyncExternalStore } from "react";
import type { Address, Hex } from "viem";
import type { EIP1193Provider } from "./wallet-adapters";
import { getPrivyAppId, getQieChain, getWorkerUrl } from "./config";
import { FlowError } from "./errors";

export type ForwardRequestTypedData = ReturnType<typeof forwardRequestTypedData>;

/** A signed-in user. The only thing the app needs from Privy, thirdweb or QIE Wallet (SPEC §0.4). */
export interface WalletSession {
  address: Address;
  authKind: RelayAuthKind;
  /** Fresh token for the worker's Authorization header. */
  getAuthToken(): Promise<string>;
  /** EIP-712 on chain 1990. Adapters throw FlowError("CANCELLED", …) when the user closes the sheet. */
  signTypedData(data: ForwardRequestTypedData): Promise<Hex>;
}

export interface Wallet {
  /** false → the UI says sign-in isn't switched on and offers no button. */
  available: boolean;
  /** Call straight from a tap: WebAuthn needs a user gesture on iOS Safari. */
  signIn(): Promise<WalletSession>;
}

// ---------------------------------------------------------------------------------------------------
// Session store: one signed-in session for the whole app, read with useSession().
// Privy keeps its own session across reloads; SIWE keeps its JWT in sessionStorage (wallet-adapters.ts).
// ---------------------------------------------------------------------------------------------------

export interface SessionState {
  session: WalletSession | null;
  /** true while Privy is still loading, so a screen doesn't flash "sign in" at someone who is signed in. */
  loading: boolean;
}

let privySession: WalletSession | null = null;
let siweSession: WalletSession | null = null;
let privyLoaded = false;
let state: SessionState = { session: null, loading: getPrivyAppId() !== null };
const SERVER_STATE: SessionState = { session: null, loading: true };
const listeners = new Set<() => void>();

function emit() {
  state = { session: privySession ?? siweSession, loading: getPrivyAppId() !== null && !privyLoaded };
  listeners.forEach((l) => l());
}

const injectedProvider = (): EIP1193Provider | null =>
  typeof window === "undefined" ? null : ((window as { ethereum?: EIP1193Provider }).ethereum ?? null);

let restoreStarted = false;
function restoreSiwe() {
  const provider = injectedProvider();
  const workerUrl = getWorkerUrl();
  if (restoreStarted || !provider || !workerUrl) return;
  restoreStarted = true;
  void import("./wallet-adapters").then(({ restoreInjected }) => {
    const restored = restoreInjected(provider, workerUrl, getQieChain());
    if (restored && !siweSession) {
      siweSession = restored;
      emit();
    }
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  restoreSiwe();
  return () => listeners.delete(listener);
}

/** The signed-in user, or null. Signing in goes through getWallet() / getQieWallet(). */
export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

export async function signOut(): Promise<void> {
  if (privySession) await privy?.signOut();
  if (siweSession) (await import("./wallet-adapters")).forgetInjected();
  privySession = siweSession = null;
  emit();
}

// ---------------------------------------------------------------------------------------------------
// Privy (passkey). The SDK is React-only, so components/PrivyWallet.tsx mounts it and registers itself here.
// ---------------------------------------------------------------------------------------------------

export interface PrivyBridge {
  signIn(): Promise<WalletSession>;
  signOut(): Promise<void>;
}

let privy: PrivyBridge | null = null;
let privyWaiters: ((bridge: PrivyBridge) => void)[] = [];
const PRIVY_LOAD_MS = 15_000;

/** Called by PrivyWallet once the SDK is ready (bridge) and whenever its session changes. */
export function registerPrivy(bridge: PrivyBridge, session: WalletSession | null) {
  privy = bridge;
  privyLoaded = true;
  privySession = session;
  emit();
  const waiting = privyWaiters;
  privyWaiters = [];
  waiting.forEach((w) => w(bridge));
}

const privyWallet: Wallet = {
  available: true,
  signIn() {
    // No await before the bridge call once the SDK is ready, so Privy's sheet opens inside the tap.
    if (privy) return privy.signIn();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        privyWaiters = privyWaiters.filter((w) => w !== waiter);
        reject(new FlowError("WALLET_UNAVAILABLE", "Sign-in is still loading. Check your connection and try again."));
      }, PRIVY_LOAD_MS);
      const waiter = (bridge: PrivyBridge) => {
        clearTimeout(timer);
        bridge.signIn().then(resolve, reject);
      };
      privyWaiters.push(waiter);
    });
  },
};

const notWired: Wallet = {
  available: false,
  async signIn() {
    throw new FlowError("WALLET_UNAVAILABLE", "Passkey sign-in isn't switched on yet.");
  },
};

/** Passkey sign-in (Privy). Unavailable, never faked, when NEXT_PUBLIC_PRIVY_APP_ID isn't set. */
export const getWallet = (): Wallet => (getPrivyAppId() ? privyWallet : notWired);

/**
 * "Connect QIE Wallet" (#86): any injected EIP-1193 wallet, signed in with SIWE.
 * Unavailable without window.ethereum or a worker URL. Client-only: on the server it is always unavailable.
 */
export function getQieWallet(): Wallet {
  const provider = injectedProvider();
  const workerUrl = getWorkerUrl();
  if (!provider || !workerUrl) return { ...notWired, signIn: async () => { throw new FlowError("WALLET_UNAVAILABLE", "No browser wallet found."); } };
  return {
    available: true,
    async signIn() {
      if (siweSession) return siweSession; // restored from this tab's sessionStorage
      const { connectInjected } = await import("./wallet-adapters");
      const session = await connectInjected(provider, workerUrl, getQieChain());
      siweSession = session;
      emit();
      return session;
    },
  };
}
