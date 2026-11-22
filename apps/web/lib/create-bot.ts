/**
 * createBot through BotForwarder (SPEC §2.1 step 4, §4.1, §4.2): read nonce → user signs → POST /relay → receipt.
 * Imported lazily on Launch so viem's contract code isn't in the first load of /create.
 */
import { QIE_RPC_URLS, qieMainnet } from "@botfolio/shared";
import {
  createPublicClient,
  encodeFunctionData,
  fallback,
  http,
  isAddressEqual,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { CreateConfig } from "./config";
import { FlowError } from "./errors";
import { validLimits, type BotLimits } from "./persona";
import { FORWARD_REQUEST_TYPES, RELAY_MAX_GAS, type ForwardRequestTypedData } from "./relay-types";
import type { WalletSession } from "./wallet";
import { postRelay } from "./worker";

// From the merged interfaces (IBotRegistry, IBotForwarder). TODO(#76): use packages/contracts/abi once exported.
export const REGISTRY_ABI = parseAbi([
  "function createBot(bytes32 personaHash, uint16 maxPerCoinBps, uint8 maxTradesPerDay) returns (uint256 botId)",
  "function botOf(address owner) view returns (uint256)",
  "event BotCreated(uint256 indexed botId, address indexed owner, bytes32 personaHash, uint16 maxPerCoinBps, uint8 maxTradesPerDay)",
]);
const FORWARDER_ABI = parseAbi(["function nonces(address owner) view returns (uint256)"]);

// Well inside the relayer's 10 min limit, so a phone clock a few minutes fast still passes.
const DEADLINE_SECONDS = 300;

export type ChainClient = Pick<PublicClient, "readContract" | "waitForTransactionReceipt">;
export type LaunchStep = "checking" | "signing" | "relaying";

/** rpc3 → 4 → 5 → 1 → 2, like the worker: rpc1/rpc2 drop TLS sometimes. */
export function createChainClient(): ChainClient {
  const urls = [...QIE_RPC_URLS.slice(2), ...QIE_RPC_URLS.slice(0, 2)];
  return createPublicClient({
    chain: qieMainnet,
    transport: fallback(urls.map((url) => http(url, { timeout: 4_000, retryCount: 0 }))),
  });
}

interface LaunchArgs {
  config: CreateConfig;
  client: ChainClient;
  session: WalletSession;
  personaHash: Hex;
  limits: BotLimits;
  onStep?: (step: LaunchStep) => void;
}

/** Resolves once the relayer has broadcast. That is not success yet: confirmBot decides that. */
export async function launchBot({ config, client, session, personaHash, limits, onStep }: LaunchArgs): Promise<Hex> {
  if (!validLimits(limits)) throw new FlowError("BAD_LIMITS", "Those limits are out of range.");
  const { forwarder, registry, workerUrl } = config;
  const from = session.address;

  onStep?.("checking");
  let existingBot: bigint;
  let nonce: bigint;
  try {
    [existingBot, nonce] = await Promise.all([
      client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "botOf", args: [from] }),
      client.readContract({ address: forwarder, abi: FORWARDER_ABI, functionName: "nonces", args: [from] }),
    ]);
  } catch {
    throw new FlowError("RPC_UNAVAILABLE", "Can't reach QIE right now. Nothing was sent. Please try again.");
  }
  if (existingBot !== 0n) throw new FlowError("ALREADY_HAS_BOT", `This wallet already has bot #${existingBot}. It's one bot per person.`);

  const typedData: ForwardRequestTypedData = {
    domain: { name: "BotFolio", version: "1", chainId: qieMainnet.id, verifyingContract: forwarder },
    types: FORWARD_REQUEST_TYPES,
    primaryType: "ForwardRequest",
    message: {
      from,
      to: registry,
      value: 0n,
      gas: RELAY_MAX_GAS, // the relayer pays. Tune after the gas report (SPEC §11).
      nonce,
      deadline: Math.floor(Date.now() / 1000) + DEADLINE_SECONDS,
      data: encodeFunctionData({
        abi: REGISTRY_ABI,
        functionName: "createBot",
        args: [personaHash, limits.maxPerCoinPct * 100, limits.maxTradesPerDay],
      }),
    },
  };

  onStep?.("signing");
  let signature: Hex;
  try {
    signature = await session.signTypedData(typedData);
  } catch (e) {
    if (e instanceof FlowError) throw e;
    throw new FlowError("SIGN_FAILED", "The signature didn't complete. Nothing was sent.");
  }

  onStep?.("relaying");
  const { to, value, gas, deadline, data } = typedData.message;
  return postRelay(workerUrl, session, { from, to, value: value.toString(), gas: gas.toString(), deadline, data, signature });
}

interface ConfirmArgs {
  config: CreateConfig;
  client: ChainClient;
  owner: Address;
  personaHash: Hex;
  txHash: Hex;
}

/**
 * Success means a mined receipt with our registry's BotCreated for this owner and persona.
 * The relayer's word alone, or a successful but unrelated tx, is not success.
 */
export async function confirmBot({ config, client, owner, personaHash, txHash }: ConfirmArgs): Promise<bigint> {
  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 45_000, pollingInterval: 1_500 });
  } catch {
    throw new FlowError("NOT_CONFIRMED", "Sent, but QIE hasn't confirmed it yet.");
  }
  if (receipt.status !== "success") throw new FlowError("REVERTED", "QIE rejected the transaction. No bot was created.");

  const created = parseEventLogs({ abi: REGISTRY_ABI, eventName: "BotCreated", logs: receipt.logs }).find(
    (log) =>
      isAddressEqual(log.address, config.registry) &&
      isAddressEqual(log.args.owner, owner) &&
      log.args.personaHash.toLowerCase() === personaHash.toLowerCase(),
  );
  if (!created) throw new FlowError("NO_EVENT", "That transaction didn't create your bot. Please try again.");
  return created.args.botId;
}
