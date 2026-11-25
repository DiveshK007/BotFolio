import { RELAY_AUTH_KIND_HEADER, type RelayErrorCode, type RelayTargetAddresses } from "@botfolio/shared";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { loadAllowedOrigins } from "../../src/auth/cors";
import { HealthState } from "../../src/health";
import { relayRoutes } from "../../src/relay/route";
import { createWorkerServer } from "../../src/server";
import { launchBot, type ChainClient } from "../../../web/lib/create-bot";
import { FlowError } from "../../../web/lib/errors";
import type { WalletSession } from "../../../web/lib/wallet";
import { TX_HASH, fakeRelay, lower } from "./helpers/fakes";
import { serve } from "./helpers/http";

// apps/web's launchBot signs and POSTs; the worker's real HTTP route and pipeline (parse, auth, policy) answer.
// Only auth, the DB guard, the chain and the sender are fakes.
const account = privateKeyToAccount(generatePrivateKey());
const forwarder = `0x${"11".repeat(20)}` as const;
const registry = `0x${"22".repeat(20)}` as const;
const other = `0x${"33".repeat(20)}` as const;
const targets: RelayTargetAddresses = { BotRegistry: registry, SeasonLedger: other, PaperLedger: other, DailyCall: other, Challenges: other };
const personaHash: Hex = `0x${"ab".repeat(32)}`;
const limits = { maxPerCoinPct: 35, maxTradesPerDay: 6 };
const client = { readContract: async ({ functionName }: { functionName: string }) => (functionName === "botOf" ? 0n : 7n) } as unknown as ChainClient;

const session = (): WalletSession => ({
  address: account.address,
  authKind: "siwe",
  getAuthToken: async () => "web-token",
  signTypedData: (data) => account.signTypedData(data),
});

type Over = Parameters<typeof fakeRelay>[0];

async function worker(over: Over = {}) {
  const f = fakeRelay({ targets, now: () => Math.floor(Date.now() / 1000), ...over });
  if (!over?.auth) f.auth.authenticate.mockImplementation(async () => ({ kind: "siwe", wallets: [lower(account.address)] }));
  const routes = relayRoutes({ relay: f.relay, origins: loadAllowedOrigins({ APP_URL: "https://app.example" }) });
  const workerUrl = await serve(createWorkerServer({ health: new HealthState({ provider: "fake", capUsd: null }), routes }));
  return { f, config: { workerUrl, forwarder, registry } };
}

describe("apps/web launchBot against the worker's real /relay route", () => {
  it("is accepted: parse, allowlist, limits and deadline pass, and web reads the txHash", async () => {
    const { f, config } = await worker();
    await expect(launchBot({ config, client, session: session(), personaHash, limits })).resolves.toBe(TX_HASH);

    // The headers web sends are the ones the worker's authenticator reads.
    const headers = f.auth.authenticate.mock.calls[0]![0];
    expect(headers.authorization).toBe("Bearer web-token");
    expect(headers[RELAY_AUTH_KIND_HEADER]).toBe("siwe");
    // The worker recognised the call as createBot, for the signer.
    expect(f.guard.reserve).toHaveBeenCalledWith(expect.objectContaining({ wallet: lower(account.address), action: expect.objectContaining({ fn: "createBot" }) }));
  });

  it.each<[string, Over, RelayErrorCode]>([
    ["a target that isn't the allowlisted registry", { targets: { ...targets, BotRegistry: other } }, "NOT_ALLOWLISTED"],
    ["a token for another wallet", { auth: { authenticate: async () => ({ kind: "siwe", wallets: [lower(other)] }) } }, "SIGNER_MISMATCH"],
  ])("a refusal for %s reaches the user as a FlowError with the worker's code", async (_name, over, code) => {
    const { config } = await worker(over);
    const failure = await launchBot({ config, client, session: session(), personaHash, limits }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(FlowError);
    expect(failure).toMatchObject({ code });
  });
});
