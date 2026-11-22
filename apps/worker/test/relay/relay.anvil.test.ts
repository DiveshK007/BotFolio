import { forwardRequestTypedData, toForwardRequest, type ForwardRequest, type ForwardRequestMessage } from "@botfolio/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeFunctionData, type Abi, type Address, type Hex } from "viem";
import { FORWARDER_ABI } from "../../src/relay/abis";
import { ForwarderChain } from "../../src/relay/chain";
import { RelayRpc } from "../../src/relay/rpc";
import { anvilReady, buildArtifacts, deploy, forkClients, startFork } from "./helpers/anvil";
import { OTHER, RELAYER, USER, lower } from "./helpers/fakes";

describe.skipIf(!anvilReady)("pre-checks on a QIE mainnet fork, real BotForwarder (#37)", () => {
  let url: string;
  let stop = () => {};
  let forwarder: Address;
  let target: Address;
  let targetAbi: Abi;
  let untrusting: Address;
  let chain: ForwarderChain;

  beforeAll(async () => {
    const built = buildArtifacts();
    ({ url, stop } = await startFork());
    forwarder = await deploy(url, built.forwarder);
    target = await deploy(url, built.target, [forwarder]);
    untrusting = await deploy(url, built.target, [OTHER.address]);
    targetAbi = built.target.abi;
    chain = new ForwarderChain(new RelayRpc([url]), forwarder, RELAYER.address);
  }, 120_000);

  afterAll(() => stop());

  const createBot = () =>
    encodeFunctionData({ abi: targetAbi, functionName: "createBot", args: [`0x${"11".repeat(32)}`, 4000, 3] });
  const setActive = (botId: bigint) => encodeFunctionData({ abi: targetAbi, functionName: "setActive", args: [botId, true] });

  async function sign(data: Hex, over: Partial<ForwardRequestMessage> = {}, signer = USER): Promise<ForwardRequest> {
    const { publicClient } = forkClients(url);
    const nonce = (await publicClient.readContract({
      address: forwarder,
      abi: FORWARDER_ABI,
      functionName: "nonces",
      args: [USER.address],
    })) as bigint;
    const { timestamp } = await publicClient.getBlock();
    const message = { from: lower(USER.address), to: target, value: 0n, gas: 300_000n, nonce, deadline: Number(timestamp) + 300, data, ...over };
    return toForwardRequest(message, await signer.signTypedData(forwardRequestTypedData(forwarder, message)));
  }

  async function broadcast(request: ForwardRequest) {
    const { publicClient, walletClient } = forkClients(url);
    const call = await chain.prepare(request);
    const hash = await walletClient.sendTransaction({ ...call, account: RELAYER, chain: publicClient.chain });
    return { call, receipt: await publicClient.waitForTransactionReceipt({ hash }) };
  }

  it("a passing request really executes, as the user and not the relayer", async () => {
    const { publicClient } = forkClients(url);
    const { call, receipt } = await broadcast(await sign(createBot()));
    expect(receipt.status).toBe("success");
    const botOf = (who: Address) =>
      publicClient.readContract({ address: target, abi: targetAbi, functionName: "botOf", args: [who] });
    expect(await botOf(USER.address)).toBe(1n);
    expect(await botOf(RELAYER.address)).toBe(0n);
    // QIE bills at least half the limit, so the limit must stay under twice what was used.
    expect(call.gas).toBeLessThan(receipt.gasUsed * 2n);
  });

  it("sees the signer through the suffix: a second createBot is refused, and costs nothing", async () => {
    const { publicClient } = forkClients(url);
    const before = await publicClient.getTransactionCount({ address: RELAYER.address });
    await expect(chain.prepare(await sign(createBot()))).rejects.toMatchObject({
      code: "WOULD_REVERT",
      details: { revertReason: "AlreadyHasBot" },
    });
    expect(await publicClient.getTransactionCount({ address: RELAYER.address })).toBe(before);
  });

  it("decodes a stale-price revert", async () => {
    await expect(chain.prepare(await sign(setActive(404n)))).rejects.toMatchObject({
      details: { revertReason: "PriceTooOld" },
    });
  });

  it("simulates at request.gas, not the node's default", async () => {
    await expect(chain.prepare(await sign(setActive(555n), { gas: 100_000n }))).rejects.toMatchObject({
      code: "WOULD_REVERT",
      details: { revertReason: "needs more gas" },
    });
    expect((await broadcast(await sign(setActive(555n)))).receipt.status).toBe("success");
  });

  it.each(["wrong signer", "wrong nonce", "expired", "untrusting target", "tampered data"])(
    "INVALID_SIGNATURE for %s",
    async (problem) => {
      const over: Partial<ForwardRequestMessage> =
        problem === "wrong nonce"
          ? { nonce: 99n }
          : problem === "expired"
            ? { deadline: 1 }
            : problem === "untrusting target"
              ? { to: untrusting }
              : {};
      const request = await sign(setActive(1n), over, problem === "wrong signer" ? OTHER : USER);
      if (problem === "tampered data") request.data = setActive(2n);
      await expect(chain.prepare(request)).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    },
  );

  it("refuses a replay", async () => {
    const request = await sign(setActive(1n));
    await broadcast(request);
    await expect(chain.prepare(request)).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
  });
});
