import { forwardRequestTypedData, qieMainnet, type ForwardRequestMessage } from "@botfolio/shared";
import { hexToString, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The worker's own SIWE check, so the message the app builds is tested against the code that will judge it.
import { NonceService } from "../../worker/src/auth/nonce";
import { verifySiwe } from "../../worker/src/auth/siwe";
import { FlowError } from "./errors";
import { connectInjected, ensureQieChain, isUserRejection, privySession, restoreInjected, type EIP1193Provider } from "./wallet-adapters";

const account = privateKeyToAccount(generatePrivateKey());
const site = { host: "botfolio.example", origin: "https://botfolio.example" };
const workerUrl = "https://worker.example";
const forwarder: Address = `0x${"11".repeat(20)}`;
const message: ForwardRequestMessage = {
  from: account.address,
  to: `0x${"22".repeat(20)}`,
  value: 0n,
  gas: 300_000n,
  nonce: 3n,
  deadline: 1_900_000_000,
  data: "0xf429b088",
};
const typedData = forwardRequestTypedData(forwarder, message);
const rejected = () => Object.assign(new Error("User rejected the request."), { code: 4001 });

/** A wallet backed by a real key. `knows1990: false` behaves like MetaMask before QIE is added. */
function fakeWallet(opts: { chainId?: number; knows1990?: boolean; reject?: string[] } = {}) {
  let chainId = opts.chainId ?? 1;
  let knows1990 = opts.knows1990 ?? false;
  const calls: string[] = [];
  const provider = {
    request: vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
      calls.push(method);
      if (opts.reject?.includes(method)) throw rejected();
      switch (method) {
        case "eth_chainId":
          return `0x${chainId.toString(16)}`;
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account.address.toLowerCase()];
        case "wallet_switchEthereumChain":
          if (!knows1990) throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
          chainId = 1990;
          return null;
        case "wallet_addEthereumChain":
          knows1990 = true;
          chainId = Number((params![0] as { chainId: string }).chainId);
          return null;
        case "personal_sign":
          return account.signMessage({ message: hexToString(params![0] as Hex) });
        case "eth_signTypedData_v4": {
          const parsed = JSON.parse(params![1] as string);
          if (parsed.domain.chainId !== chainId) throw new Error("Provided chainId must match the active chainId");
          return account.signTypedData(typedData);
        }
        default:
          throw new Error(`unexpected ${method}`);
      }
    }),
  } as unknown as EIP1193Provider;
  return { provider, calls };
}

/** The worker's /auth routes, in memory: real nonces, real verifySiwe. */
function fakeWorker(prefix = "jwt", now = () => Date.now()) {
  const nonces = new NonceService(now);
  let issued = 0;
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === `${workerUrl}/auth/nonce`) return new Response(JSON.stringify(nonces.issue()));
    if (url === `${workerUrl}/auth/verify`) {
      try {
        const wallet = await verifySiwe(JSON.parse(init!.body as string), { domain: site.host, nonces, now });
        issued++;
        const expiresAt = new Date(now() + 900_000).toISOString();
        return new Response(JSON.stringify({ ok: true, token: `${prefix}-${issued}`, address: wallet, expiresAt }));
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: { code: (e as { code: string }).code, message: "refused" } }), { status: 401 });
      }
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("isUserRejection", () => {
  it("sees 4001 at any depth and in plain words", () => {
    expect(isUserRejection(rejected())).toBe(true);
    expect(isUserRejection({ cause: { cause: { code: 4001 } } })).toBe(true);
    expect(isUserRejection(new Error("User denied message signature"))).toBe(true);
    expect(isUserRejection(new Error("Unrecognized chain ID"))).toBe(false);
    expect(isUserRejection(undefined)).toBe(false);
  });
});

describe("ensureQieChain", () => {
  it("does nothing on 1990", async () => {
    const { provider, calls } = fakeWallet({ chainId: 1990 });
    await ensureQieChain(provider, qieMainnet);
    expect(calls).toEqual(["eth_chainId"]);
  });

  it("adds QIE mainnet when the wallet doesn't know it", async () => {
    const { provider, calls } = fakeWallet();
    await ensureQieChain(provider, qieMainnet);
    expect(calls).toEqual(["eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_chainId"]);
    const add = (provider.request as ReturnType<typeof vi.fn>).mock.calls.find(([a]) => a.method === "wallet_addEthereumChain")![0];
    expect(add.params[0]).toMatchObject({ chainId: "0x7c6", nativeCurrency: { symbol: "QIE", decimals: 18 } });
  });

  it("a refused switch is a cancel, and nothing is added", async () => {
    const { provider, calls } = fakeWallet({ reject: ["wallet_switchEthereumChain"] });
    await expect(ensureQieChain(provider, qieMainnet)).rejects.toMatchObject({ code: "CANCELLED" });
    expect(calls).not.toContain("wallet_addEthereumChain");
  });
});

describe("connectInjected (Connect QIE Wallet + SIWE)", () => {
  it("signs in with a message the worker accepts and signs ForwardRequests on 1990", async () => {
    const worker = fakeWorker();
    const { provider } = fakeWallet({ knows1990: true });
    const session = await connectInjected(provider, workerUrl, qieMainnet, site);

    expect(session).toMatchObject({ address: account.address, authKind: "siwe" });
    await expect(session.getAuthToken()).resolves.toBe("jwt-1");
    expect(worker).toHaveBeenCalledTimes(2); // nonce + verify, no more

    const signature = await session.signTypedData(typedData);
    await expect(recoverTypedDataAddress({ ...typedData, signature })).resolves.toBe(account.address);
  });

  it("closing the wallet is a cancel", async () => {
    fakeWorker();
    const { provider } = fakeWallet({ knows1990: true, reject: ["personal_sign"] });
    const error = await connectInjected(provider, workerUrl, qieMainnet, site).catch((e) => e);
    expect(error).toBeInstanceOf(FlowError);
    expect(error.code).toBe("CANCELLED");
  });

  it("passes the worker's refusal through", async () => {
    fakeWorker();
    const { provider } = fakeWallet({ knows1990: true });
    await expect(connectInjected(provider, workerUrl, qieMainnet, { ...site, host: "evil.example" })).rejects.toMatchObject({
      code: "DOMAIN_MISMATCH",
    });
  });

  it("closing the signature sheet is a cancel", async () => {
    fakeWorker();
    const { provider } = fakeWallet({ knows1990: true, reject: ["eth_signTypedData_v4"] });
    const session = await connectInjected(provider, workerUrl, qieMainnet, site);
    await expect(session.signTypedData(typedData)).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("restores from sessionStorage while fresh, and signs in again once the JWT is about to expire", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    fakeWorker();
    const { provider } = fakeWallet({ knows1990: true });
    await connectInjected(provider, workerUrl, qieMainnet, site);

    const restored = restoreInjected(provider, workerUrl, qieMainnet, site);
    await expect(restored?.getAuthToken()).resolves.toBe("jwt-1");

    vi.setSystemTime(Date.now() + 880_000); // inside the 30 s margin of the 15 min token
    expect(restoreInjected(provider, workerUrl, qieMainnet, site)).toBeNull();
    fakeWorker("jwt2"); // a fresh worker, so a fresh token
    await expect(restored?.getAuthToken()).resolves.toBe("jwt2-1");
    expect(restoreInjected(provider, workerUrl, qieMainnet, site)).not.toBeNull();
  });
});

describe("privySession", () => {
  const embedded = (chainId: string) => {
    const { provider } = fakeWallet({ chainId: 1990 });
    return { address: account.address.toLowerCase(), chainId, switchChain: vi.fn(async () => {}), getEthereumProvider: async () => provider };
  };

  it("uses the Privy access token and signs with the embedded wallet", async () => {
    const wallet = embedded("eip155:1990");
    const session = privySession(wallet, async () => "privy-token");
    expect(session).toMatchObject({ address: account.address, authKind: "privy" });
    await expect(session.getAuthToken()).resolves.toBe("privy-token");
    const signature = await session.signTypedData(typedData);
    await expect(recoverTypedDataAddress({ ...typedData, signature })).resolves.toBe(account.address);
    expect(wallet.switchChain).not.toHaveBeenCalled();
  });

  it("moves the wallet to 1990 first if it's elsewhere", async () => {
    const wallet = embedded("eip155:1");
    await privySession(wallet, async () => "t").signTypedData(typedData);
    expect(wallet.switchChain).toHaveBeenCalledWith(1990);
  });

  it("no token means signed out", async () => {
    await expect(privySession(embedded("eip155:1990"), async () => null).getAuthToken()).rejects.toMatchObject({ code: "SIGNED_OUT" });
  });
});
