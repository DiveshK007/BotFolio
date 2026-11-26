import { forwardRequestFromJson, forwardRequestTypedData, RELAY_LIMITS, findAllowlisted, type ForwardRequestJson } from "@botfolio/shared";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmBot, launchBot, REGISTRY_ABI, type ChainClient, type LaunchStep } from "./create-bot";
import { FlowError } from "./errors";
import type { WalletSession } from "./wallet";

// Mocked relay and chain; the signature is real, from a key generated per run.
const account = privateKeyToAccount(generatePrivateKey());
const forwarder: Address = `0x${"11".repeat(20)}`;
const registry: Address = `0x${"22".repeat(20)}`;
const config = { workerUrl: "https://worker.example", forwarder, registry };
const personaHash: Hex = `0x${"ab".repeat(32)}`;
const txHash: Hex = `0x${"ef".repeat(32)}`;
const limits = { maxPerCoinPct: 35, maxTradesPerDay: 6 };

const session: WalletSession = {
  address: account.address,
  authKind: "privy",
  getAuthToken: async () => "test-token",
  signTypedData: (data) => account.signTypedData(data),
};

const chain = (over: { botOf?: bigint; receipt?: () => Promise<unknown> } = {}) =>
  ({
    readContract: async ({ functionName }: { functionName: string }) => (functionName === "botOf" ? (over.botOf ?? 0n) : 7n),
    waitForTransactionReceipt: over.receipt,
  }) as unknown as ChainClient;

const mockRelay = () => {
  const mock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true, status: "submitted", txHash })));
  vi.stubGlobal("fetch", mock);
  return mock;
};

afterEach(() => vi.unstubAllGlobals());

describe("launchBot against a mocked /relay", () => {
  it("relays a createBot request the forwarder would accept", async () => {
    const relay = mockRelay();
    const steps: LaunchStep[] = [];
    await expect(
      launchBot({ config, client: chain(), session, personaHash, limits, onStep: (s) => steps.push(s) }),
    ).resolves.toBe(txHash);
    expect(steps).toEqual(["checking", "signing", "relaying"]);

    const [url, init] = relay.mock.calls[0]!;
    expect(url).toBe("https://worker.example/relay");
    const { request } = JSON.parse(init!.body as string) as { request: ForwardRequestJson };
    expect(request).toMatchObject({ from: account.address, to: registry, value: "0", gas: "300000" });
    expect(request).not.toHaveProperty("nonce");
    expect(request.deadline - Date.now() / 1000).toBeLessThanOrEqual(RELAY_LIMITS.maxDeadlineSeconds);
    const other: Address = `0x${"33".repeat(20)}`;
    const targets = { BotRegistry: registry, SeasonLedger: other, PaperLedger: other, DailyCall: other, Challenges: other };
    expect(findAllowlisted(targets, request.to, request.data)?.fn).toBe("createBot");

    expect(decodeFunctionData({ abi: REGISTRY_ABI, data: request.data })).toEqual({
      functionName: "createBot",
      args: [personaHash, 3500, 6],
    });

    // What forwarder.verify() does: rebuild the message with nonces(from) and recover the signer.
    const { signature, ...signed } = forwardRequestFromJson(request);
    const signer = await recoverTypedDataAddress({
      ...forwardRequestTypedData(forwarder, { ...signed, nonce: 7n }),
      signature,
    });
    expect(signer).toBe(account.address);
  });

  it("stops before signing when the wallet already has a bot", async () => {
    const relay = mockRelay();
    const sign = vi.fn<WalletSession["signTypedData"]>();
    await expect(
      launchBot({ config, client: chain({ botOf: 12n }), session: { ...session, signTypedData: sign }, personaHash, limits }),
    ).rejects.toMatchObject({ code: "ALREADY_HAS_BOT" });
    expect(sign).not.toHaveBeenCalled();
    expect(relay).not.toHaveBeenCalled();
  });

  it("sends nothing when the signature fails", async () => {
    const relay = mockRelay();
    const signTypedData = async () => Promise.reject(new Error("closed"));
    await expect(
      launchBot({ config, client: chain(), session: { ...session, signTypedData }, personaHash, limits }),
    ).rejects.toMatchObject({ code: "SIGN_FAILED" });
    expect(relay).not.toHaveBeenCalled();
  });

  it("a closed signature sheet stays a cancel (not a failure) and sends nothing", async () => {
    const relay = mockRelay();
    const signTypedData = async () => Promise.reject(new FlowError("CANCELLED", "You closed the signature. Nothing was sent."));
    await expect(
      launchBot({ config, client: chain(), session: { ...session, signTypedData }, personaHash, limits }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(relay).not.toHaveBeenCalled();
  });

  it("a rate-limited relay reaches the user in the relayer's words", async () => {
    const body = { ok: false, error: { code: "RATE_LIMITED_IP", message: "Too many new bots from here today.", retryAfterSeconds: 3600 } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 429 })));
    await expect(launchBot({ config, client: chain(), session, personaHash, limits })).rejects.toMatchObject({
      code: "RATE_LIMITED_IP",
      message: "Too many new bots from here today.",
    });
  });

  it("sends nothing for limits off the slider steps", async () => {
    const relay = mockRelay();
    await expect(
      launchBot({ config, client: chain(), session, personaHash, limits: { maxPerCoinPct: 33, maxTradesPerDay: 6 } }),
    ).rejects.toMatchObject({ code: "BAD_LIMITS" });
    expect(relay).not.toHaveBeenCalled();
  });
});

describe("confirmBot", () => {
  const created = (over: { address?: Address; owner?: Address; hash?: Hex } = {}) => ({
    address: over.address ?? registry,
    topics: encodeEventTopics({
      abi: REGISTRY_ABI,
      eventName: "BotCreated",
      args: { botId: 42n, owner: over.owner ?? account.address },
    }),
    data: encodeAbiParameters([{ type: "bytes32" }, { type: "uint16" }, { type: "uint8" }], [over.hash ?? personaHash, 3500, 6]),
  });
  const confirm = (receipt: () => Promise<unknown>) =>
    confirmBot({ config, client: chain({ receipt }), owner: account.address, personaHash, txHash });

  it("returns the botId from the event", async () => {
    await expect(confirm(async () => ({ status: "success", logs: [created()] }))).resolves.toBe(42n);
  });

  it("a revert is a failure", async () => {
    await expect(confirm(async () => ({ status: "reverted", logs: [] }))).rejects.toMatchObject({ code: "REVERTED" });
  });

  it.each([
    ["no event", []],
    ["another contract", [created({ address: forwarder })]],
    ["another owner", [created({ owner: forwarder })]],
    ["another persona", [created({ hash: txHash })]],
  ])("a successful tx with %s is not success", async (_name, logs) => {
    await expect(confirm(async () => ({ status: "success", logs }))).rejects.toMatchObject({ code: "NO_EVENT" });
  });

  it("no receipt yet means unconfirmed, not failed", async () => {
    await expect(confirm(async () => Promise.reject(new Error("timeout")))).rejects.toMatchObject({ code: "NOT_CONFIRMED" });
  });
});
