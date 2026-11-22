import { BaseError, TransactionReceiptNotFoundError, type Address, type Hex, type PublicClient } from "viem";
import { QIE_CHAIN_ID } from "@botfolio/shared";
import { createQiePublicClient } from "../chain";
import { CONTRACT_NAMES, REGISTRY_VIEWS, SCORE_VIEWS } from "./abi";
import type { ContractAddresses } from "./config";

export interface RawLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
}

export interface BotState {
  house: boolean;
  active: boolean;
  banned: boolean;
}

/**
 * One RPC endpoint. A batch never mixes two: QIE's RPCs answer `eth_getLogs` beyond their own head with [] and no
 * error (checked on rpc3/4/5, Nov 22 2026), so a head from one node and logs from a slower one would lose events silently.
 */
export interface ChainSource {
  readonly name: string;
  /** Throws unless this is chain 1990 with code at every configured address. */
  check(): Promise<void>;
  head(): Promise<bigint>;
  /** Whether any of our contracts had code at that block. Needs historical state. */
  hasCodeAt(block: bigint): Promise<boolean>;
  /** Both ends inclusive. */
  logs(fromBlock: bigint, toBlock: bigint): Promise<RawLog[]>;
  blockTime(block: bigint): Promise<bigint>;
  botState(botId: bigint, atBlock: bigint): Promise<BotState>;
  scores(season: number, atBlock: bigint): Promise<{ root: Hex; rulesVersion: Hex }>;
  /** null if the tx isn't on the chain. */
  txPosition(hash: Hex): Promise<{ block: bigint; index: number } | null>;
}

/** An RPC problem, never an event's fault: retry on another endpoint and don't skip anything. */
export class ChainError extends Error {}

/**
 * Only the host is kept: an RPC URL can carry an API key, and viem's full messages print the URL.
 */
export function createChainSource(url: string, addresses: ContractAddresses): ChainSource {
  const name = new URL(url).host;
  const client: PublicClient = createQiePublicClient({ chainId: QIE_CHAIN_ID, rpcUrls: [url] });

  async function call<T>(what: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof ChainError) throw e;
      const why = e instanceof BaseError ? e.shortMessage : "request failed";
      throw new ChainError(`${name} ${what}: ${why}`);
    }
  }

  let checked = false;

  return {
    name,

    async check() {
      if (checked) return;
      await call("check", async () => {
        const chainId = await client.getChainId();
        if (chainId !== QIE_CHAIN_ID) throw new ChainError(`${name} is chain ${chainId}, not ${QIE_CHAIN_ID}`);
        for (const contract of CONTRACT_NAMES) {
          const code = await client.getCode({ address: addresses[contract] });
          // A wrong address emits nothing, which would look like a quiet day.
          if (!code || code === "0x") throw new ChainError(`${name} has no code at the ${contract} address`);
        }
      });
      checked = true;
    },

    // viem caches the block number for 4 s by default.
    head: () => call("eth_blockNumber", () => client.getBlockNumber({ cacheTime: 0 })),

    hasCodeAt: (blockNumber) =>
      call("historical eth_getCode", async () => {
        const codes = await Promise.all(
          Object.values(addresses).map((address) => client.getCode({ address, blockNumber })),
        );
        return codes.some((code) => code !== undefined && code !== "0x");
      }),

    logs: (fromBlock, toBlock) =>
      call("eth_getLogs", async () => {
        const logs = await client.getLogs({ address: Object.values(addresses), fromBlock, toBlock });
        return logs.map(({ address, topics, data, blockNumber, transactionHash, logIndex }) => {
          if (blockNumber === null || transactionHash === null || logIndex === null) {
            throw new ChainError(`${name} returned a pending log`);
          }
          return { address, topics: [...topics], data, blockNumber, transactionHash, logIndex };
        });
      }),

    blockTime: (blockNumber) =>
      call("eth_getBlockByNumber", async () => (await client.getBlock({ blockNumber })).timestamp),

    botState: (botId, blockNumber) =>
      call("bot state", async () => {
        const contract = { address: addresses.BotRegistry, abi: REGISTRY_VIEWS, blockNumber } as const;
        const [bot, banned] = await Promise.all([
          client.readContract({ ...contract, functionName: "getBot", args: [botId] }),
          client.readContract({ ...contract, functionName: "banned", args: [botId] }),
        ]);
        return { house: bot.house, active: bot.active, banned };
      }),

    scores: (season, blockNumber) =>
      call("scores", async () => {
        const contract = { address: addresses.TrustScoreRegistry, abi: SCORE_VIEWS, blockNumber } as const;
        const [root, rulesVersion] = await Promise.all([
          client.readContract({ ...contract, functionName: "scoresRoot", args: [season] }),
          client.readContract({ ...contract, functionName: "rulesVersionOf", args: [season] }),
        ]);
        return { root, rulesVersion };
      }),

    txPosition: (hash) =>
      call("eth_getTransactionReceipt", async () => {
        try {
          const receipt = await client.getTransactionReceipt({ hash });
          return { block: receipt.blockNumber, index: receipt.transactionIndex };
        } catch (e) {
          if (e instanceof TransactionReceiptNotFoundError) return null;
          throw e;
        }
      }),
  };
}
