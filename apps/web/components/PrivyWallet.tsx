"use client";

/**
 * Privy passkey wallet (#71, SPEC §0.4). Loaded with next/dynamic from WalletRoot only when
 * NEXT_PUBLIC_PRIVY_APP_ID is set. It wraps nothing: it registers sign-in and the session with lib/wallet.ts,
 * so screens use getWallet() / useSession() and never import the SDK.
 */
import { getAccessToken, PrivyProvider, useCreateWallet, useLogin, useLogout, usePrivy, useWallets, type PrivyClientConfig } from "@privy-io/react-auth";
import { useEffect, useMemo, useRef, useState } from "react";
import { getQieChain } from "@/lib/config";
import { FlowError } from "@/lib/errors";
import { privySession } from "@/lib/wallet-adapters";
import { registerPrivy, type WalletSession } from "@/lib/wallet";

/** createOnLogin makes the wallet after login; if it hasn't shown up by then, say so instead of hanging. */
const WALLET_WAIT_MS = 20_000;

interface Pending {
  resolve(session: WalletSession): void;
  reject(error: FlowError): void;
}

function Bridge() {
  const { ready, authenticated } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { logout } = useLogout();
  const { createWallet } = useCreateWallet();
  const pending = useRef<Pending | null>(null);

  const fail = (error: FlowError) => {
    pending.current?.reject(error);
    pending.current = null;
  };

  const { login } = useLogin({
    onComplete: () => {
      const waiting = pending.current;
      setTimeout(() => pending.current === waiting && fail(new FlowError("WALLET_FAILED", "Signed in, but your wallet didn't finish setting up. Please try again.")), WALLET_WAIT_MS);
    },
    onError: (code) =>
      fail(
        code === "exited_auth_flow"
          ? new FlowError("CANCELLED", "You closed the sign-in. Nothing was sent.")
          : new FlowError("SIGN_IN_FAILED", "Sign-in didn't complete. Please try again."),
      ),
  });

  // Only Privy's own embedded EOA: a linked external wallet isn't what the passkey signs with.
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const session = useMemo(
    () => (authenticated && embedded ? privySession(embedded, getAccessToken) : null),
    // A new session object only when the signer changes, not on every wallets refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authenticated, embedded?.address],
  );

  // Kept in a ref so the registered bridge always sees the latest render.
  const latest = useRef({ session, authenticated, walletsReady, embedded, login, logout, createWallet });
  useEffect(() => {
    latest.current = { session, authenticated, walletsReady, embedded, login, logout, createWallet };
  }); // before the effect below, so it runs first

  useEffect(() => {
    if (!ready || !walletsReady) return;
    if (session && pending.current) {
      pending.current.resolve(session);
      pending.current = null;
    }
    registerPrivy(
      {
        signIn() {
          const now = latest.current;
          if (now.session) return Promise.resolve(now.session);
          if (pending.current) return Promise.reject(new FlowError("BUSY", "Sign-in is already open."));
          const result = new Promise<WalletSession>((resolve, reject) => (pending.current = { resolve, reject }));
          if (!now.authenticated) {
            now.login(); // synchronous inside the tap: Privy's sheet then runs WebAuthn on the user's own tap
          } else if (!now.embedded) {
            // Signed in earlier but the wallet was never made (e.g. the sheet was closed halfway).
            now.createWallet().catch(() => fail(new FlowError("WALLET_FAILED", "Your wallet didn't finish setting up. Please try again.")));
          }
          return result;
        },
        async signOut() {
          await latest.current.logout();
        },
      },
      session,
    );
  }, [ready, walletsReady, session]);

  return null;
}

export default function PrivyWallet({ appId }: { appId: string }) {
  const [config] = useState<PrivyClientConfig>(() => {
    const chain = getQieChain();
    return {
      // Passkey where the device has WebAuthn; email only as the fallback for devices that don't (#71).
      loginMethods: typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" ? ["passkey"] : ["email"],
      // QIE mainnet only. No smart wallets: QIE has no ERC-4337 (CLAUDE.md).
      defaultChain: chain,
      supportedChains: [chain],
      embeddedWallets: { ethereum: { createOnLogin: "all-users" } },
      appearance: { landingHeader: "Sign in to BotFolio", loginMessage: "Play money. Not investment advice. No prizes." },
      legal: { termsAndConditionsUrl: "/terms", privacyPolicyUrl: "/privacy" },
    };
  });
  return (
    <PrivyProvider appId={appId} config={config}>
      <Bridge />
    </PrivyProvider>
  );
}
