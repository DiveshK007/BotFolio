import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RELAY_ALLOWLIST, forwardRequestTypedData, toForwardRequest } from "@botfolio/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContractAddress, keccak256, toBytes, encodeFunctionData, type Abi, type Address, type Hex } from "viem";
import { FORWARDER_ABI, TARGET_ABIS } from "../../src/relay/abis";
import { ForwarderChain } from "../../src/relay/chain";
import { RelayRpc } from "../../src/relay/rpc";
import { CONTRACTS, FOUNDRY_BIN, anvilReady, deploy, forkClients, startFork } from "./helpers/anvil";
import { RELAYER, lower, testAccount } from "./helpers/fakes";

function artifact(name: string) {
  const json = JSON.parse(readFileSync(join(CONTRACTS, `out/${name}.sol/${name}.json`), "utf8"));
  return { abi: json.abi as Abi, bytecode: json.bytecode.object as Hex, selectors: json.methodIdentifiers as Record<string, string> };
}

/** The contracts that will really be deployed, not the test target. */
describe.skipIf(!anvilReady)("against the real BotFolio contracts (#37, #38)", () => {
  let url: string;
  let stop = () => {};
  let forwarder: Address;
  let registry: Address;
  let chain: ForwarderChain;
  const user = testAccount(3);

  beforeAll(async () => {
    execFileSync(join(FOUNDRY_BIN, "forge"), ["build", "--root", CONTRACTS, "--skip", "test", "script"], { stdio: "pipe" });
    ({ url, stop } = await startFork());
    const admin = RELAYER.address;
    forwarder = await deploy(url, artifact("BotForwarder"));
    // As in Deploy.s.sol: the ledger is told the registry's address one tx before the registry exists.
    const { publicClient, walletClient } = forkClients(url);
    const nonce = await publicClient.getTransactionCount({ address: admin });
    const predicted = getContractAddress({ from: admin, nonce: BigInt(nonce + 1) });
    const ledger = await deploy(url, artifact("PaperLedger"), [forwarder, admin, predicted, 1078n * 10n ** 8n]);
    registry = await deploy(url, artifact("BotRegistry"), [forwarder, admin, ledger]);
    const hash = await walletClient.writeContract({
      address: ledger,
      abi: TARGET_ABIS.PaperLedger,
      functionName: "grantRole",
      args: [keccak256(toBytes("REGISTRY_ROLE")), registry],
      account: RELAYER,
      chain: walletClient.chain,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    chain = new ForwarderChain(new RelayRpc([url]), forwarder, admin);
  }, 240_000);

  afterAll(() => stop());

  it.each(RELAY_ALLOWLIST.map((e) => [`${e.contract}.${e.fn}`, e] as const))(
    "the compiled contract has %s's selector",
    (_name, entry) => {
      expect(`0x${artifact(entry.contract).selectors[entry.signature]}`).toBe(entry.selector);
    },
  );

  async function prepare(data: Hex) {
    const { publicClient } = forkClients(url);
    const nonce = (await publicClient.readContract({
      address: forwarder,
      abi: FORWARDER_ABI,
      functionName: "nonces",
      args: [user.address],
    })) as bigint;
    const { timestamp } = await publicClient.getBlock();
    const message = { from: lower(user.address), to: registry, value: 0n, gas: 300_000n, nonce, deadline: Number(timestamp) + 300, data };
    const signature = await user.signTypedData(forwardRequestTypedData(forwarder, message));
    return chain.prepare(toForwardRequest(message, signature));
  }

  it("relays createBot within twice the gas it uses, then refuses a second bot for free", async () => {
    const { publicClient, walletClient } = forkClients(url);
    const data = encodeFunctionData({
      abi: TARGET_ABIS.BotRegistry,
      functionName: "createBot",
      args: [`0x${"11".repeat(32)}`, 4000, 3],
    });
    const call = await prepare(data);
    const hash = await walletClient.sendTransaction({ ...call, account: RELAYER, chain: walletClient.chain });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");
    expect(call.gas).toBeLessThan(receipt.gasUsed * 2n);
    const botOf = await publicClient.readContract({
      address: registry,
      abi: TARGET_ABIS.BotRegistry,
      functionName: "botOf",
      args: [user.address],
    });
    expect(botOf).toBe(1n);

    await expect(prepare(data)).rejects.toMatchObject({
      code: "WOULD_REVERT",
      details: { revertReason: "AlreadyHasBot", message: "This wallet already has a bot. It's one bot per person." },
    });
  });
});
