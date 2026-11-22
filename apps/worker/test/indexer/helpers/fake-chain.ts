import {
  encodeAbiParameters,
  encodeEventTopics,
  padHex,
  toHex,
  zeroHash,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";
import { CONTRACT_EVENTS, CONTRACT_NAMES, type ContractName } from "../../../src/indexer/abi";
import { ChainError, type BotState, type ChainSource, type RawLog } from "../../../src/indexer/chain";
import type { ContractAddresses } from "../../../src/indexer/config";
import type { EventArgs, EventName } from "../../../src/indexer/handlers/types";

export const ADDRESSES = Object.fromEntries(
  CONTRACT_NAMES.map((name, i) => [name, padHex(toHex(0xc0de00 + i), { size: 20 })]),
) as ContractAddresses;

export const START = 100n;
export const GENESIS_TIME = 1_790_000_000n;
export const timeOf = (block: bigint) => GENESIS_TIME + block * 4n;

export interface Tx {
  hash: Hex;
  block: bigint;
  index: number;
}

/**
 * A chain in memory, with the real event encoding. `as(name)` gives a second endpoint on the same chain whose
 * head or health can be different.
 */
export class FakeChain {
  head = START;
  readonly logs: RawLog[] = [];
  private readonly bots = new Map<bigint, { block: bigint; state: BotState }[]>();
  private readonly roots = new Map<number, { block: bigint; root: Hex; rulesVersion: Hex }[]>();
  private readonly txs: Tx[] = [];

  /** A tx in a new block, or another one in the same block with `{ sameBlock: true }`. */
  tx(options: { sameBlock?: boolean } = {}): Tx {
    if (!options.sameBlock) this.head += 1n;
    const index = this.txs.filter((t) => t.block === this.head).length;
    const tx = { hash: padHex(toHex(0xab0000 + this.txs.length), { size: 32 }), block: this.head, index };
    this.txs.push(tx);
    return tx;
  }

  mine(blocks: number): void {
    this.head += BigInt(blocks);
  }

  emit<C extends ContractName, E extends EventName<C>>(
    tx: Tx,
    contract: C,
    eventName: E,
    args: EventArgs<C, E>,
    address: Address = ADDRESSES[contract],
  ): RawLog {
    const abi = CONTRACT_EVENTS[contract] as Abi;
    const item = abi.find((i): i is AbiEvent => i.type === "event" && i.name === eventName)!;
    const values = args as unknown as Record<string, unknown>;
    const inData = item.inputs.filter((input) => !input.indexed);
    const log: RawLog = {
      address,
      topics: encodeEventTopics({ abi: [item], eventName: item.name, args: values }) as Hex[],
      data: encodeAbiParameters(inData, inData.map((input) => values[input.name!])),
      blockNumber: tx.block,
      transactionHash: tx.hash,
      logIndex: this.logs.filter((l) => l.blockNumber === tx.block).length,
    };
    this.logs.push(log);
    return log;
  }

  setBot(botId: bigint, state: Partial<BotState>, block: bigint = this.head): void {
    const history = this.bots.get(botId) ?? [];
    const previous = history.at(-1)?.state ?? { house: false, active: true, banned: false };
    history.push({ block, state: { ...previous, ...state } });
    this.bots.set(botId, history);
  }

  setRoot(season: number, root: Hex, rulesVersion: Hex, block: bigint = this.head): void {
    const history = this.roots.get(season) ?? [];
    history.push({ block, root, rulesVersion });
    this.roots.set(season, history);
  }

  as(name = "rpc", options: { head?: () => bigint; down?: () => boolean; fail?: (method: string) => boolean } = {}) {
    const head = options.head ?? (() => this.head);
    const guard = (method: string) => {
      if (options.down?.() || options.fail?.(method)) throw new ChainError(`${name} ${method} failed`);
    };
    const at = <T extends { block: bigint }>(list: T[] | undefined, block: bigint) =>
      list?.filter((entry) => entry.block <= block).at(-1);
    const requests: { from: bigint; to: bigint }[] = [];

    const source: ChainSource & { requests: typeof requests } = {
      name,
      requests,
      check: async () => guard("check"),
      head: async () => {
        guard("head");
        return head();
      },
      logs: async (from, to) => {
        requests.push({ from, to });
        guard("logs");
        // Like QIE's RPCs: past its own head a node just returns fewer logs, without an error.
        return this.logs.filter((l) => l.blockNumber >= from && l.blockNumber <= to && l.blockNumber <= head());
      },
      blockTime: async (block) => {
        guard("blockTime");
        return timeOf(block);
      },
      botState: async (botId, block) => {
        guard("botState");
        return at(this.bots.get(botId), block)?.state ?? { house: false, active: true, banned: false };
      },
      scores: async (season, block) => {
        guard("scores");
        return at(this.roots.get(season), block) ?? { root: zeroHash, rulesVersion: zeroHash };
      },
      txPosition: async (hash) => {
        guard("txPosition");
        const tx = this.txs.find((t) => t.hash === hash);
        return tx ? { block: tx.block, index: tx.index } : null;
      },
    };
    return source;
  }
}
