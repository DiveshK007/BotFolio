import type { forwardRequestTypedData, RelayAuthKind } from "@botfolio/shared";
import type { Address, Hex } from "viem";
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

// TODO(#71): return the Privy passkey wallet here (thirdweb if the spike fails).
// Until then there is deliberately no stand-in signer: an unwired wallet must not look like a working one.
const notWired: Wallet = {
  available: false,
  async signIn() {
    throw new FlowError("WALLET_UNAVAILABLE", "Passkey sign-in isn't switched on yet.");
  },
};

export const getWallet = (): Wallet => notWired;
