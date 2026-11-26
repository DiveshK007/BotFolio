import { findAllowlisted, forwardRequestFromJson, forwardRequestTypedData, RELAY_LIMITS, type ForwardRequestJson } from "@botfolio/shared";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHIPS as INDEXER_CHIPS } from "../../worker/src/indexer/handlers/season-ledger";
import type { OwnerConfig } from "./config";
import {
  CHALLENGES_ABI,
  CHIPS,
  confirmAction,
  DAILY_CALL_ABI,
  encodeAction,
  OWNER_REGISTRY_ABI,
  PAPER_LEDGER_ABI,
  relayAction,
  SEASON_LEDGER_ABI,
  type ChainClient,
  type OwnerAction,
} from "./relay-call";
import type { WalletSession } from "./wallet";

const account = privateKeyToAccount(generatePrivateKey());
const addr = (b: string) => `0x${b.repeat(20)}` as Address;
const targets = { BotRegistry: addr("21"), SeasonLedger: addr("22"), PaperLedger: addr("23"), DailyCall: addr("24"), Challenges: addr("25") };
const config: OwnerConfig = { workerUrl: "https://worker.example", forwarder: addr("11"), targets };
const h = (b: string) => `0x${b.repeat(32)}` as Hex;
const txHash = h("ef");
const order = { botId: 7n, asset: 4, buy: true, bps: 3500, decisionId: h("0d"), actionIndex: 1, deadline: 1_900_000_000n };

const session: WalletSession = {
  address: account.address,
  authKind: "privy",
  getAuthToken: async () => "test-token",
  signTypedData: (data) => account.signTypedData(data),
};

const ACTIONS: [OwnerAction, string, unknown[]][] = [
  [{ kind: "setActive", botId: 7n, active: false }, "setActive", [7n, false]],
  [{ kind: "recordCorrection", botId: 7n, decisionId: h("0d"), noteHash: h("00"), chip: 2 }, "recordCorrection", [7n, h("0d"), h("00"), 2]],
  [{ kind: "executeApproved", order, runnerSig: "0x1234" }, "executeApproved", [order, "0x1234"]],
  [{ kind: "dailyCall", botId: 7n, userUp: true, botUp: false, botSig: "0xabcd" }, "call", [7n, true, false, "0xabcd"]],
  [{ kind: "commitVersion", botId: 7n, version: 2, hash: h("aa"), maxPerCoinBps: 2500, maxTradesPerDay: 3 }, "commitVersion", [7n, 2, h("aa"), 2500, 3]],
  [{ kind: "createChallenge", botId: 7n, season: 3 }, "create", [7n, 3]],
  [{ kind: "acceptChallenge", code: h("c0"), botId: 9n }, "accept", [h("c0"), 9n]],
];
const ABIS = [...OWNER_REGISTRY_ABI, ...SEASON_LEDGER_ABI, ...PAPER_LEDGER_ABI, ...DAILY_CALL_ABI, ...CHALLENGES_ABI];

afterEach(() => vi.unstubAllGlobals());

describe("encodeAction", () => {
  it.each(ACTIONS)("%o is on the relay allowlist with the right arguments", (action, fn, args) => {
    const { contract, data } = encodeAction(action);
    expect(findAllowlisted(targets, targets[contract], data)?.fn).toBe(fn);
    expect(decodeFunctionData({ abi: ABIS, data })).toEqual({ functionName: fn, args });
  });

  it("uses the indexer's chip ids", () => {
    expect(CHIPS).toEqual(INDEXER_CHIPS);
  });
});

describe("relayAction", () => {
  const chain = { readContract: async () => 4n } as unknown as ChainClient;

  it("signs a forward request to the action's contract that the forwarder would accept", async () => {
    const relay = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true, status: "submitted", txHash })));
    vi.stubGlobal("fetch", relay);
    const steps: string[] = [];
    await expect(relayAction({ config, client: chain, session, action: ACTIONS[4]![0], onStep: (s) => steps.push(s) })).resolves.toBe(txHash);
    expect(steps).toEqual(["checking", "signing", "relaying"]);

    const [url, init] = relay.mock.calls[0]!;
    expect(url).toBe("https://worker.example/relay");
    const { request } = JSON.parse(init!.body as string) as { request: ForwardRequestJson };
    expect(request).toMatchObject({ from: account.address, to: targets.SeasonLedger, value: "0", gas: "300000" });
    expect(request.deadline - Date.now() / 1000).toBeLessThanOrEqual(RELAY_LIMITS.maxDeadlineSeconds);
    const { signature, ...signed } = forwardRequestFromJson(request);
    expect(await recoverTypedDataAddress({ ...forwardRequestTypedData(config.forwarder, { ...signed, nonce: 4n }), signature })).toBe(account.address);
  });

  it("sends nothing when the contract isn't deployed", async () => {
    const relay = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", relay);
    const sign = vi.fn();
    const noDaily = { ...config, targets: { ...targets, DailyCall: undefined } };
    await expect(
      relayAction({ config: noDaily, client: chain, session: { ...session, signTypedData: sign }, action: ACTIONS[3]![0] }),
    ).rejects.toMatchObject({ code: "NOT_LIVE" });
    expect(sign).not.toHaveBeenCalled();
    expect(relay).not.toHaveBeenCalled();
  });

  it("passes on the relayer's plain-words refusal", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ ok: false, error: { code: "WOULD_REVERT", message: "Price too old. Try again in a few minutes." } }), { status: 422 }),
    );
    await expect(relayAction({ config, client: chain, session, action: ACTIONS[2]![0] })).rejects.toMatchObject({
      code: "WOULD_REVERT",
      message: "Price too old. Try again in a few minutes.",
    });
  });
});

describe("confirmAction", () => {
  const versionLog = (address: Address, hash: Hex) => ({
    address,
    topics: encodeEventTopics({ abi: SEASON_LEDGER_ABI, eventName: "VersionCommitted", args: { botId: 7n, version: 2 } }),
    data: encodeAbiParameters([{ type: "bytes32" }, { type: "uint32" }], [hash, 3]),
    blockNumber: 1n, logIndex: 0, transactionHash: txHash, transactionIndex: 0, blockHash: h("01"), removed: false,
  });
  const receipt = (status: string, logs: unknown[]) =>
    ({ waitForTransactionReceipt: async () => ({ status, logs }) }) as unknown as ChainClient;
  const action = ACTIONS[4]![0];

  it("needs the action's own event, from our contract, with the hash the owner approved", async () => {
    const ok = await confirmAction({ config, client: receipt("success", [versionLog(targets.SeasonLedger, h("aa"))]), action, txHash });
    expect(ok.eventName).toBe("VersionCommitted");
    await expect(confirmAction({ config, client: receipt("success", [versionLog(addr("99"), h("aa"))]), action, txHash })).rejects.toMatchObject({ code: "NO_EVENT" });
    await expect(confirmAction({ config, client: receipt("success", [versionLog(targets.SeasonLedger, h("bb"))]), action, txHash })).rejects.toMatchObject({ code: "NO_EVENT" });
  });

  it("says so when the tx reverted or isn't mined yet", async () => {
    await expect(confirmAction({ config, client: receipt("reverted", []), action, txHash })).rejects.toMatchObject({ code: "REVERTED" });
    const slow = { waitForTransactionReceipt: async () => Promise.reject(new Error("timeout")) } as unknown as ChainClient;
    await expect(confirmAction({ config, client: slow, action, txHash })).rejects.toMatchObject({ code: "NOT_CONFIRMED" });
  });
});
