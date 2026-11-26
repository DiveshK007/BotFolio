import type { AssetId } from "@botfolio/shared";
import type { Abi, Address, Hex, PublicClient } from "viem";
import { REGISTRY_VIEWS } from "../indexer/abi";
import { ASSET_IDS, type LedgerOrder } from "../interfaces";
import { TARGET_ABIS } from "../relay/abis";
import type { SystemSender } from "../system/sender";
import type { Portfolio } from "../gate/types";
import { tradesTodayFrom } from "../gate/ledger-math";

export interface ChainBot {
  owner: Address;
  personaHash: Hex;
  version: number;
  createdAt: Date;
  active: boolean;
  house: boolean;
  maxPerCoinBps: number;
  maxTradesPerDay: number;
}

export interface LedgerState {
  bot: ChainBot;
  portfolio: Portfolio;
  tradesToday: number;
}

export interface RunnerChain {
  bot(botId: bigint): Promise<ChainBot>;
  /** Limits, cash, holdings and today's trade count: what the gate has to agree with. */
  state(botId: bigint, nowSeconds: number): Promise<LedgerState>;
  nextBotId(): Promise<bigint>;
  startCashE8(): Promise<bigint>;
  orderUsed(orderId: Hex): Promise<boolean>;
  /** The latest block's timestamp: what the contracts compare deadlines with. */
  chainSeconds(): Promise<number>;
  executeBatch(orders: readonly LedgerOrder[]): Promise<Hex>;
}

/**
 * #337: QIE once estimated ~22k for a 1-order batch that needs ~120k, and all 4 tries ran out of gas.
 * A too-low limit can also starve the oracle staticcall, which the ledger treats as a stale skip, not a revert.
 * docs/gas.md: ~40k + ~83k per order; 171k for 1 order on a 5-holding portfolio. QIE bills ≥ half the limit,
 * so this floor stays below the real cost of a full batch.
 */
export const executeBatchMinGas = (orders: number) => 60_000n + 130_000n * BigInt(orders);

export function createRunnerChain(opts: {
  client: PublicClient;
  registry: Address;
  ledger: Address;
  sender: SystemSender;
}): RunnerChain {
  const { client, registry, ledger, sender } = opts;
  const ledgerAbi: Abi = TARGET_ABIS.PaperLedger;
  const registryAbi: Abi = TARGET_ABIS.BotRegistry;
  const readLedger = (functionName: string, args: unknown[] = []) =>
    client.readContract({ address: ledger, abi: ledgerAbi, functionName, args });
  let startCash: bigint | undefined;

  async function bot(botId: bigint): Promise<ChainBot> {
    const b = await client.readContract({ address: registry, abi: REGISTRY_VIEWS, functionName: "getBot", args: [botId] });
    return {
      owner: b.owner.toLowerCase() as Address,
      personaHash: b.personaHash,
      version: b.version,
      createdAt: new Date(Number(b.createdAt) * 1000),
      active: b.active,
      house: b.house,
      maxPerCoinBps: b.maxPerCoinBps,
      maxTradesPerDay: b.maxTradesPerDay,
    };
  }

  return {
    bot,

    async state(botId, nowSeconds) {
      const [onChain, account, units] = await Promise.all([
        bot(botId),
        readLedger("portfolios", [botId]) as Promise<readonly [bigint, number, number, boolean]>,
        readLedger("holdings", [botId]) as Promise<readonly bigint[]>,
      ]);
      const [cashE8, lastDay, tradesToday] = account;
      return {
        bot: onChain,
        portfolio: {
          cashE8,
          unitsE18: Object.fromEntries(ASSET_IDS.map((asset, i) => [asset, units[i]!])) as Record<AssetId, bigint>,
        },
        tradesToday: tradesTodayFrom({ lastDay, tradesToday }, nowSeconds),
      };
    },

    async nextBotId() {
      return (await client.readContract({ address: registry, abi: registryAbi, functionName: "nextBotId" })) as bigint;
    },

    async startCashE8() {
      return (startCash ??= (await readLedger("START_CASH_E8")) as bigint);
    },

    async orderUsed(orderId) {
      return (await readLedger("usedOrder", [orderId])) as boolean;
    },

    async chainSeconds() {
      return Number((await client.getBlock({ blockTag: "latest" })).timestamp);
    },

    async executeBatch(orders) {
      const args = [orders.map(({ botId, asset, buy, bps, decisionId, actionIndex }) => ({ botId, asset, buy, bps, decisionId, actionIndex }))];
      return (await sender.write({ address: ledger, abi: ledgerAbi, functionName: "executeBatch", args, minGas: executeBatchMinGas(orders.length) })).transactionHash;
    },
  };
}
