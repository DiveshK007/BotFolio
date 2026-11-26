import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletSession } from "./wallet";

const session = { address: `0x${"aa".repeat(20)}`, authKind: "privy" } as unknown as WalletSession;

// wallet.ts keeps module state (the Privy bridge), so each test gets a fresh copy.
const load = () => import("./wallet");

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("getWallet (passkey)", () => {
  it("is honestly unavailable without NEXT_PUBLIC_PRIVY_APP_ID", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "");
    const { getWallet } = await load();
    expect(getWallet().available).toBe(false);
    await expect(getWallet().signIn()).rejects.toMatchObject({ code: "WALLET_UNAVAILABLE" });
  });

  it("calls the Privy bridge synchronously once it's registered (keeps the tap for WebAuthn)", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "app-id");
    const { getWallet, registerPrivy } = await load();
    const signIn = vi.fn(async () => session);
    registerPrivy({ signIn, signOut: async () => {} }, null);
    const result = getWallet().signIn();
    expect(signIn).toHaveBeenCalledTimes(1); // before any await
    await expect(result).resolves.toBe(session);
  });

  it("waits for the SDK if tapped while it loads, then gives up with a clear error", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "app-id");
    vi.useFakeTimers();
    const { getWallet, registerPrivy } = await load();
    const early = getWallet().signIn();
    registerPrivy({ signIn: async () => session, signOut: async () => {} }, null);
    await expect(early).resolves.toBe(session);

    vi.resetModules();
    const fresh = await load();
    const late = fresh.getWallet().signIn();
    vi.advanceTimersByTime(15_000);
    await expect(late).rejects.toMatchObject({ code: "WALLET_UNAVAILABLE" });
  });
});

describe("getQieWallet (injected)", () => {
  it("needs window.ethereum and a worker URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_RELAY_URL", "https://worker.example");
    const { getQieWallet } = await load();
    expect(getQieWallet().available).toBe(false); // no window in node

    vi.stubGlobal("window", { ethereum: { request: vi.fn() }, location: { host: "x", origin: "https://x" } });
    expect(getQieWallet().available).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_RELAY_URL", "");
    expect(getQieWallet().available).toBe(false);
  });
});
