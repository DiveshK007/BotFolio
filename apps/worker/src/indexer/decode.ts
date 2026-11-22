import { decodeEventLog, type Abi, type Hex } from "viem";
import { ADMIN_TOPICS, CONTRACT_EVENTS, CONTRACT_NAMES, type ContractName } from "./abi";
import { ChainError, type RawLog } from "./chain";
import type { ContractAddresses } from "./config";

export interface LogPosition {
  block: bigint;
  /** Lowercase. */
  txHash: Hex;
  logIndex: number;
}

export interface IndexedEvent extends LogPosition {
  contract: ContractName;
  name: string;
  args: unknown;
}

export interface UnreadableLog extends LogPosition {
  contract: ContractName;
  topic: string;
}

export interface DecodedLogs {
  /** In chain order. */
  events: IndexedEvent[];
  /** From our contracts, but not an event we know. Reported, never fatal. */
  unreadable: UnreadableLog[];
}

/**
 * The emitting address picks the ABI, so a copy of our event signature from any other contract, or from the
 * wrong one of our own, can't write a row.
 */
export function decodeLogs(
  logs: RawLog[],
  addresses: ContractAddresses,
  range: { from: bigint; to: bigint },
): DecodedLogs {
  const contractAt = new Map(CONTRACT_NAMES.map((name) => [addresses[name].toLowerCase(), name]));
  const events: IndexedEvent[] = [];
  const unreadable: UnreadableLog[] = [];
  const seen = new Set<string>();

  for (const log of [...logs].sort(chainOrder)) {
    const contract = contractAt.get(log.address.toLowerCase());
    if (!contract) continue;
    // An answer for other blocks than we asked for can't be trusted to be complete either.
    if (log.blockNumber < range.from || log.blockNumber > range.to) {
      throw new ChainError(`RPC returned block ${log.blockNumber} for range ${range.from}..${range.to}`);
    }

    const topic = log.topics[0]?.toLowerCase();
    if (topic && ADMIN_TOPICS.has(topic)) continue;

    const txHash = log.transactionHash.toLowerCase() as Hex;
    // (tx, logIndex) is an event's identity: one the RPC sends twice is still one event.
    const id = `${txHash}:${log.logIndex}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const at = { contract, block: log.blockNumber, txHash, logIndex: log.logIndex };
    try {
      const { eventName, args } = decodeEventLog({
        abi: CONTRACT_EVENTS[contract] as Abi,
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      }) as unknown as { eventName: string; args: unknown };
      events.push({ ...at, name: eventName, args });
    } catch {
      unreadable.push({ ...at, topic: topic ?? "none" });
    }
  }

  return { events, unreadable };
}

function chainOrder(a: RawLog, b: RawLog): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}
