/**
 * The two ways to get a WalletSession (SPEC §2.6): Privy's embedded passkey wallet, and an injected EIP-1193 wallet
 * (QIE Wallet / MetaMask) that signs in with SIWE. Both sign ForwardRequests with eth_signTypedData_v4 on chain 1990.
 * Imported lazily, so viem's wallet code isn't in the first load of any page.
 */
import {
  AUTH_NONCE_PATH,
  AUTH_VERIFY_PATH,
  QIE_CHAIN_ID,
  SIWE_STATEMENT,
  type AuthNonceResponse,
  type AuthVerifyError,
  type AuthVerifySuccess,
} from "@botfolio/shared";
import { createWalletClient, custom, getAddress, isAddress, type Address, type Chain, type Hex } from "viem";
import { createSiweMessage } from "viem/siwe";
import { FlowError } from "./errors";
import type { ForwardRequestTypedData, WalletSession } from "./wallet";

/** Anything with an EIP-1193 `request`: window.ethereum, or the provider Privy hands out. */
export type EIP1193Provider = Parameters<typeof custom>[0];

const CANCELLED = "You closed the wallet. Nothing was sent.";

/** EIP-1193 4001, ethers' ACTION_REJECTED, or a wallet that only says so in words. viem keeps the original in `cause`. */
export function isUserRejection(e: unknown): boolean {
  let x = e as { code?: unknown; message?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; x && depth < 8; depth++, x = x.cause as typeof x) {
    if (x.code === 4001 || x.code === "ACTION_REJECTED") return true;
    if (typeof x.message === "string" && /user (rejected|denied|cancel|closed)|rejected by user|request rejected/i.test(x.message)) return true;
  }
  return false;
}

function rethrow(e: unknown, code: string, message: string): never {
  if (e instanceof FlowError) throw e;
  if (isUserRejection(e)) throw new FlowError("CANCELLED", CANCELLED);
  throw new FlowError(code, message);
}

/** EIP-712 through the wallet. Closing the sheet → FlowError("CANCELLED"); anything else is left for launchBot to word. */
export async function signTypedDataWith(provider: EIP1193Provider, address: Address, data: ForwardRequestTypedData): Promise<Hex> {
  const client = createWalletClient({ account: address, transport: custom(provider) });
  try {
    return await client.signTypedData(data);
  } catch (e) {
    if (isUserRejection(e)) throw new FlowError("CANCELLED", "You closed the signature. Nothing was sent.");
    throw e;
  }
}

/**
 * MetaMask refuses eth_signTypedData_v4 when the domain's chainId isn't the active chain, so switch first.
 * Unknown chain → wallet_addEthereumChain (which also switches). Mobile wallets don't all send 4902, so any
 * non-rejection error from the switch tries the add.
 */
export async function ensureQieChain(provider: EIP1193Provider, chain: Chain): Promise<void> {
  const client = createWalletClient({ transport: custom(provider) });
  const wrong = "Switch your wallet to QIE mainnet (chain 1990) and try again.";
  try {
    if ((await client.getChainId()) === chain.id) return;
    try {
      await client.switchChain({ id: chain.id });
    } catch (e) {
      if (isUserRejection(e)) throw e;
      await client.addChain({ chain });
    }
    if ((await client.getChainId()) !== chain.id) throw new FlowError("WRONG_CHAIN", wrong);
  } catch (e) {
    rethrow(e, "WRONG_CHAIN", wrong);
  }
}

// ---------------------------------------------------------------------------------------------------
// Privy embedded wallet
// ---------------------------------------------------------------------------------------------------

/** The part of Privy's ConnectedWallet we use, so tests don't need the SDK. */
export interface EmbeddedWallet {
  address: string;
  /** CAIP-2, e.g. "eip155:1990". */
  chainId: string;
  switchChain(chainId: number): Promise<void>;
  getEthereumProvider(): Promise<EIP1193Provider>;
}

export function privySession(wallet: EmbeddedWallet, getAccessToken: () => Promise<string | null>): WalletSession {
  const address = getAddress(wallet.address);
  return {
    address,
    authKind: "privy",
    async getAuthToken() {
      const token = await getAccessToken().catch(() => null);
      if (!token) throw new FlowError("SIGNED_OUT", "Your sign-in expired. Please sign in again.");
      return token;
    },
    async signTypedData(data) {
      if (wallet.chainId !== `eip155:${QIE_CHAIN_ID}`) await wallet.switchChain(QIE_CHAIN_ID);
      return signTypedDataWith(await wallet.getEthereumProvider(), address, data);
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Injected wallet + SIWE (SPEC §11: GET /auth/nonce → personal_sign EIP-4361 → POST /auth/verify → 15-min JWT)
// ---------------------------------------------------------------------------------------------------

/** sessionStorage only: the JWT dies with the tab and is never in localStorage. */
const STORE_KEY = "bf-siwe";
/** Treat a token as expired a little early so it can't lapse between our check and the worker's. */
const EXPIRY_MARGIN_MS = 30_000;
const TIMEOUT_MS = 15_000;

interface SiweToken {
  address: Address;
  token: string;
  expiresAt: string;
}

interface Site {
  host: string;
  origin: string;
}

const fresh = (t: SiweToken, now = Date.now()) => Date.parse(t.expiresAt) - EXPIRY_MARGIN_MS > now;

function readStored(): SiweToken | null {
  try {
    const t = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "null") as SiweToken | null;
    return t && typeof t.address === "string" && isAddress(t.address) && typeof t.token === "string" && fresh(t) ? t : null;
  } catch {
    return null;
  }
}

function store(t: SiweToken | null) {
  try {
    if (t) sessionStorage.setItem(STORE_KEY, JSON.stringify(t));
    else sessionStorage.removeItem(STORE_KEY);
  } catch {
    // Private mode: the session just won't survive a reload.
  }
}

async function siweLogin(provider: EIP1193Provider, workerUrl: string, address: Address, site: Site): Promise<SiweToken> {
  const unreachable = "Can't reach BotFolio to sign you in. Please try again.";
  let nonce: AuthNonceResponse;
  try {
    const res = await fetch(workerUrl + AUTH_NONCE_PATH, { credentials: "omit", signal: AbortSignal.timeout(TIMEOUT_MS) });
    nonce = (await res.json()) as AuthNonceResponse;
    if (!res.ok || typeof nonce?.nonce !== "string" || typeof nonce.issuedAt !== "string") throw new Error("bad nonce");
  } catch {
    throw new FlowError("NO_ANSWER", unreachable);
  }

  // The worker rebuilds this text and compares it exactly, and checks domain === SIWE_DOMAIN (apps/worker/src/auth/siwe.ts).
  const message = createSiweMessage({
    domain: site.host,
    address,
    statement: SIWE_STATEMENT,
    uri: site.origin,
    version: "1",
    chainId: QIE_CHAIN_ID,
    nonce: nonce.nonce,
    issuedAt: new Date(nonce.issuedAt), // the worker's clock, not the phone's
  });

  let signature: Hex;
  try {
    signature = await createWalletClient({ account: address, transport: custom(provider) }).signMessage({ message });
  } catch (e) {
    rethrow(e, "SIGN_FAILED", "The sign-in signature didn't complete. Please try again.");
  }

  let json: AuthVerifySuccess | AuthVerifyError | null;
  try {
    const res = await fetch(workerUrl + AUTH_VERIFY_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature }),
      credentials: "omit",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    json = (await res.json().catch(() => null)) as typeof json;
  } catch {
    throw new FlowError("NO_ANSWER", unreachable);
  }
  if (json?.ok === true && typeof json.token === "string" && isAddress(json.address) && getAddress(json.address) === address) {
    return { address, token: json.token, expiresAt: json.expiresAt };
  }
  if (json?.ok === false && typeof json.error?.message === "string") throw new FlowError(json.error.code, json.error.message.slice(0, 200));
  throw new FlowError("BAD_RESPONSE", unreachable);
}

function injectedSession(provider: EIP1193Provider, workerUrl: string, chain: Chain, first: SiweToken, site: Site): WalletSession {
  let current = first;
  return {
    address: current.address,
    authKind: "siwe",
    // The JWT lasts 15 min. A slow coach gets one more wallet prompt instead of a dead end.
    async getAuthToken() {
      if (!fresh(current)) {
        current = await siweLogin(provider, workerUrl, current.address, site);
        store(current);
      }
      return current.token;
    },
    async signTypedData(data) {
      await ensureQieChain(provider, chain);
      return signTypedDataWith(provider, current.address, data);
    },
  };
}

const here = (): Site => ({ host: window.location.host, origin: window.location.origin });

/** "Connect QIE Wallet": accounts → chain 1990 → SIWE. Runs from a tap. */
export async function connectInjected(provider: EIP1193Provider, workerUrl: string, chain: Chain, site: Site = here()): Promise<WalletSession> {
  let address: Address | undefined;
  try {
    [address] = await createWalletClient({ transport: custom(provider) }).requestAddresses();
  } catch (e) {
    rethrow(e, "WALLET_UNAVAILABLE", "Your wallet didn't connect. Please try again.");
  }
  if (!address) throw new FlowError("WALLET_UNAVAILABLE", "Your wallet didn't share an account. Unlock it and try again.");
  address = getAddress(address);

  await ensureQieChain(provider, chain);
  const token = await siweLogin(provider, workerUrl, address, site);
  store(token);
  return injectedSession(provider, workerUrl, chain, token, site);
}

/** Same tab, token still fresh → signed in again without a prompt. */
export function restoreInjected(provider: EIP1193Provider, workerUrl: string, chain: Chain, site: Site = here()): WalletSession | null {
  const token = readStored();
  return token && injectedSession(provider, workerUrl, chain, token, site);
}

export const forgetInjected = () => store(null);
