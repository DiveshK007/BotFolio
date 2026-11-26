"use client";

import dynamic from "next/dynamic";
import { getPrivyAppId } from "@/lib/config";

// Browser-only and out of the first load: the Privy SDK is large and shows nothing until someone signs in.
const PrivyWallet = dynamic(() => import("./PrivyWallet"), { ssr: false });

/** Mounted once in the root layout so a passkey session survives page changes (#71). */
export function WalletRoot() {
  const appId = getPrivyAppId();
  return appId ? <PrivyWallet appId={appId} /> : null;
}
