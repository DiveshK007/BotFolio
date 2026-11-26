/**
 * Every owner action is one EIP-712 ForwardRequest through BotForwarder, relayed by the worker (SPEC §4.1, §11):
 * encode the allowlisted call → read the forwarder nonce → the owner signs → POST /relay → check the receipt.
 * The relayer pays the gas. Prices are never an argument: the contracts read the oracle themselves.
 */
import {
  forwardRequestToJson,
  forwardRequestTypedData,
  qieMainnet,
  RELAY_LIMITS,
  toForwardRequest,
  type ApprovedOrder,
  type ForwardRequestMessage,
  type RelayTargetContract,
} from "@botfolio/shared";
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
import { getRpcUrls, type OwnerConfig } from "./config";
import { FlowError } from "./errors";
import type { WalletSession } from "./wallet";
import { postRelay } from "./worker";

export const FORWARDER_ABI = parseAbi(["function nonces(address owner) view returns (uint256)"]);

export type ChainClient = Pick<PublicClient, "readContract" | "waitForTransactionReceipt">;
export type LaunchStep = "checking" | "signing" | "relaying";

/** Fails over through NEXT_PUBLIC_QIE_RPC_URLS (default rpc3 → 4 → 5 → 1 → 2). */
export function createChainClient(): ChainClient {
  return createPublicClient({
    chain: qieMainnet,
    transport: fallback(getRpcUrls().map((url) => http(url, { timeout: 4_000, retryCount: 0 }))),
  });
}

// Just the items the owner screens use. abi.test.ts checks them against packages/contracts/abi.
export const OWNER_REGISTRY_ABI = parseAbi([
  "function setActive(uint256 botId, bool active)",
  "event BotActiveChanged(uint256 indexed botId, bool active)",
]);
export const SEASON_LEDGER_ABI = parseAbi([
  "function commitVersion(uint256 botId, uint32 version, bytes32 hash, uint16 maxPerCoinBps, uint8 maxTradesPerDay)",
  "function recordCorrection(uint256 botId, bytes32 decisionId, bytes32 noteHash, uint8 chip)",
  "function currentSeason() view returns (uint32)",
  "function nextSeason() view returns (uint32)",
  "function seasonState(uint32 n) view returns (uint8)",
  "event VersionCommitted(uint256 indexed botId, uint32 indexed version, bytes32 hash, uint32 season)",
  "event CallCorrected(uint256 indexed botId, bytes32 indexed decisionId, bytes32 noteHash, uint8 chip, uint32 season)",
]);
export const PAPER_LEDGER_ABI = parseAbi([
  "function executeApproved((uint256 botId, uint8 asset, bool buy, uint16 bps, bytes32 decisionId, uint8 actionIndex, uint64 deadline) o, bytes runnerSig)",
  "event ApprovedTrade(uint256 indexed botId, bytes32 indexed decisionId, uint8 actionIndex, address indexed owner)",
]);
export const DAILY_CALL_ABI = parseAbi([
  "function call(uint256 botId, bool userUp, bool botUp, bytes botSig)",
  "event Called(uint256 indexed botId, uint32 indexed day, bool userUp, bool botUp, int256 price, uint80 roundId)",
]);
export const CHALLENGES_ABI = parseAbi([
  "function create(uint256 myBot, uint32 season) returns (bytes32)",
  "function accept(bytes32 code, uint256 theirBot)",
  "event ChallengeCreated(bytes32 indexed code, uint256 indexed myBot, uint32 season)",
  "event ChallengeAccepted(bytes32 indexed code, uint256 indexed theirBot)",
]);
const SEASON_CLOSED = 2; // ISeasonLedger.SeasonState { NONE, OPEN, CLOSED }

/**
 * The season a new challenge can join (#359). Between closeSeason(n) (~21:30 IST) and openSeason(n+1) (00:00 IST),
 * currentSeason() is still n but n is CLOSED, so Challenges.create(n) reverts: use nextSeason(). Otherwise the live one.
 */
export async function joinableSeason(client: ChainClient, ledger: Address): Promise<{ season: number; next: boolean }> {
  const current = await client.readContract({ address: ledger, abi: SEASON_LEDGER_ABI, functionName: "currentSeason" });
  const state = await client.readContract({ address: ledger, abi: SEASON_LEDGER_ABI, functionName: "seasonState", args: [current] });
  if (state !== SEASON_CLOSED) return { season: current, next: false };
  return { season: await client.readContract({ address: ledger, abi: SEASON_LEDGER_ABI, functionName: "nextSeason" }), next: true };
}

const EVENTS = [...OWNER_REGISTRY_ABI, ...SEASON_LEDGER_ABI, ...PAPER_LEDGER_ABI, ...DAILY_CALL_ABI, ...CHALLENGES_ABI];

/**
 * UNVERIFIED: no spec gives the chips' uint8 ids. Same order as the indexer's CHIPS
 * (apps/worker/src/indexer/handlers/season-ledger.ts); relay-call.test.ts keeps the two in step.
 */
export const CHIPS = ["too risky", "too timid", "wrong coin", "sold too early", "blocked"] as const;
export const BLOCKED_CHIP = CHIPS.indexOf("blocked");

/** The seven owner actions on the relay allowlist (createBot stays in create-bot.ts). */
export type OwnerAction =
  | { kind: "setActive"; botId: bigint; active: boolean }
  | { kind: "recordCorrection"; botId: bigint; decisionId: Hex; noteHash: Hex; chip: number }
  | { kind: "executeApproved"; order: ApprovedOrder; runnerSig: Hex }
  | { kind: "dailyCall"; botId: bigint; userUp: boolean; botUp: boolean; botSig: Hex }
  | { kind: "commitVersion"; botId: bigint; version: number; hash: Hex; maxPerCoinBps: number; maxTradesPerDay: number }
  | { kind: "createChallenge"; botId: bigint; season: number }
  | { kind: "acceptChallenge"; code: Hex; botId: bigint };

/** Which contract an action goes to, and its calldata. */
export function encodeAction(a: OwnerAction): { contract: RelayTargetContract; data: Hex } {
  switch (a.kind) {
    case "setActive":
      return { contract: "BotRegistry", data: encodeFunctionData({ abi: OWNER_REGISTRY_ABI, functionName: "setActive", args: [a.botId, a.active] }) };
    case "recordCorrection":
      return {
        contract: "SeasonLedger",
        data: encodeFunctionData({ abi: SEASON_LEDGER_ABI, functionName: "recordCorrection", args: [a.botId, a.decisionId, a.noteHash, a.chip] }),
      };
    case "commitVersion":
      return {
        contract: "SeasonLedger",
        data: encodeFunctionData({
          abi: SEASON_LEDGER_ABI,
          functionName: "commitVersion",
          args: [a.botId, a.version, a.hash, a.maxPerCoinBps, a.maxTradesPerDay],
        }),
      };
    case "executeApproved":
      return { contract: "PaperLedger", data: encodeFunctionData({ abi: PAPER_LEDGER_ABI, functionName: "executeApproved", args: [a.order, a.runnerSig] }) };
    case "dailyCall":
      return { contract: "DailyCall", data: encodeFunctionData({ abi: DAILY_CALL_ABI, functionName: "call", args: [a.botId, a.userUp, a.botUp, a.botSig] }) };
    case "createChallenge":
      return { contract: "Challenges", data: encodeFunctionData({ abi: CHALLENGES_ABI, functionName: "create", args: [a.botId, a.season] }) };
    case "acceptChallenge":
      return { contract: "Challenges", data: encodeFunctionData({ abi: CHALLENGES_ABI, functionName: "accept", args: [a.code, a.botId] }) };
  }
}

// Well inside the relayer's 10 min limit, so a phone clock a few minutes fast still passes.
const DEADLINE_SECONDS = 300;

interface SignAndRelayArgs {
  workerUrl: string;
  forwarder: Address;
  client: ChainClient;
  session: WalletSession;
  to: Address;
  data: Hex;
  onStep?: (step: LaunchStep) => void;
  /** Shown when the relay answer is lost. */
  noAnswer?: string;
}

/** Nonce → signature → POST /relay. Resolves with the broadcast tx hash; the receipt is the caller's check. */
export async function signAndRelay({ workerUrl, forwarder, client, session, to, data, onStep, noAnswer }: SignAndRelayArgs): Promise<Hex> {
  const from = session.address;
  let nonce: bigint;
  try {
    nonce = await client.readContract({ address: forwarder, abi: FORWARDER_ABI, functionName: "nonces", args: [from] });
  } catch {
    throw new FlowError("RPC_UNAVAILABLE", "Can't reach QIE right now. Nothing was sent. Please try again.");
  }
  const message: ForwardRequestMessage = {
    from,
    to,
    value: RELAY_LIMITS.value,
    gas: RELAY_LIMITS.maxGas, // the relayer pays. Tune after the gas report (SPEC §11).
    nonce,
    deadline: Math.floor(Date.now() / 1000) + DEADLINE_SECONDS,
    data,
  };

  onStep?.("signing");
  let signature: Hex;
  try {
    signature = await session.signTypedData(forwardRequestTypedData(forwarder, message));
  } catch (e) {
    if (e instanceof FlowError) throw e;
    throw new FlowError("SIGN_FAILED", "The signature didn't complete. Nothing was sent.");
  }

  onStep?.("relaying");
  return postRelay(workerUrl, session, forwardRequestToJson(toForwardRequest(message, signature)), noAnswer);
}

interface RelayActionArgs {
  config: OwnerConfig;
  client: ChainClient;
  session: WalletSession;
  action: OwnerAction;
  onStep?: (step: LaunchStep) => void;
}

/** One owner action, end to end up to the broadcast. Safe to retry: the forwarder nonce stops a double send. */
export async function relayAction({ config, client, session, action, onStep }: RelayActionArgs): Promise<Hex> {
  const { contract, data } = encodeAction(action);
  const to = config.targets[contract];
  if (!to) throw new FlowError("NOT_LIVE", "That isn't switched on yet. Nothing was sent.");
  onStep?.("checking");
  return signAndRelay({
    workerUrl: config.workerUrl,
    forwarder: config.forwarder,
    client,
    session,
    to,
    data,
    onStep,
    noAnswer: "We couldn't confirm it went through. Check your bot's page before trying again.",
  });
}

/** The event that proves an action happened, as decoded from the receipt. */
export type ActionEvent = ReturnType<typeof parseEventLogs<typeof EVENTS>>[number];

const EVENT_OF: Record<OwnerAction["kind"], string> = {
  setActive: "BotActiveChanged",
  recordCorrection: "CallCorrected",
  executeApproved: "ApprovedTrade",
  dailyCall: "Called",
  commitVersion: "VersionCommitted",
  createChallenge: "ChallengeCreated",
  acceptChallenge: "ChallengeAccepted",
};

/** True when `args` is this action's own event: same bot, same call, and for commitVersion the same hash. */
function matches(a: OwnerAction, args: Record<string, unknown>): boolean {
  switch (a.kind) {
    case "setActive":
      return args.botId === a.botId && args.active === a.active;
    case "recordCorrection":
      return args.botId === a.botId && String(args.decisionId).toLowerCase() === a.decisionId.toLowerCase() && args.chip === a.chip;
    case "executeApproved":
      return args.botId === a.order.botId && String(args.decisionId).toLowerCase() === a.order.decisionId.toLowerCase() && args.actionIndex === a.order.actionIndex;
    case "dailyCall":
      return args.botId === a.botId && args.userUp === a.userUp;
    case "commitVersion":
      return args.botId === a.botId && args.version === a.version && String(args.hash).toLowerCase() === a.hash.toLowerCase();
    case "createChallenge":
      return args.myBot === a.botId;
    case "acceptChallenge":
      return String(args.code).toLowerCase() === a.code.toLowerCase() && args.theirBot === a.botId;
  }
}

interface ConfirmActionArgs {
  config: OwnerConfig;
  client: ChainClient;
  action: OwnerAction;
  txHash: Hex;
}

/**
 * Success means a mined receipt carrying this action's event from our contract. The relayer's word alone, or a
 * successful but unrelated tx, is not success.
 */
export async function confirmAction({ config, client, action, txHash }: ConfirmActionArgs): Promise<ActionEvent> {
  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 45_000, pollingInterval: 1_500 });
  } catch {
    throw new FlowError("NOT_CONFIRMED", "Sent, but QIE hasn't confirmed it yet.");
  }
  if (receipt.status !== "success") throw new FlowError("REVERTED", "QIE rejected the transaction. Nothing changed.");
  const address = config.targets[encodeAction(action).contract]!;
  const event = parseEventLogs({ abi: EVENTS, logs: receipt.logs }).find(
    (log) => isAddressEqual(log.address, address) && log.eventName === EVENT_OF[action.kind] && matches(action, log.args as Record<string, unknown>),
  );
  if (!event) throw new FlowError("NO_EVENT", "That transaction didn't do what we asked. Please try again.");
  return event;
}
