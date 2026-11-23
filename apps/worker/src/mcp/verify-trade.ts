import { ASSETS, type AssetId } from "@botfolio/shared";
import { decodeEventLog, parseAbi, type Address, type Hex, type PublicClient } from "viem";

const LEDGER = parseAbi([
  "event Trade(uint256 indexed botId, uint8 indexed asset, bool buy, uint256 cashE8, uint256 unitsE18, uint256 priceE8, uint80 roundId, uint256 updatedAt, bytes32 indexed decisionId, uint8 actionIndex)",
]);
const FEED = parseAbi(["function getRoundData(uint80 roundId) view returns (uint80, int256, uint256, uint256, uint80)"]);

export interface VerifiedTrade {
  bot_id: string;
  asset: AssetId;
  side: "BUY" | "SELL";
  /** 8 decimals, what PaperLedger read from the oracle and settled at. */
  price_e8: string;
  round_id: string;
  /** What the feed returns for that round today. */
  oracle_price_e8: string;
  matches_oracle: boolean;
  log_index: number;
}

export interface TradeCheck {
  tx_hash: Hex;
  /** The tx is on-chain, succeeded, and emitted at least one Trade from PaperLedger. */
  valid: boolean;
  /** Every Trade's price equals the oracle's answer for its round. */
  matches_oracle: boolean;
  block_number: string | null;
  trades: VerifiedTrade[];
  note: string;
}

/**
 * SPEC §10.1 `verify_trade`: re-reads the tx's `Trade` events and each oracle round from QIE, nothing from our
 * database. One `executeBatch` tx can hold several trades, so each is checked.
 */
export async function verifyTrade(client: PublicClient, ledger: Address, txHash: Hex): Promise<TradeCheck> {
  const empty = (note: string): TradeCheck => ({ tx_hash: txHash, valid: false, matches_oracle: false, block_number: null, trades: [], note });
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch {
    return empty("No such transaction on QIE mainnet.");
  }
  if (receipt.status !== "success") return { ...empty("The transaction reverted."), block_number: receipt.blockNumber.toString() };

  const trades: VerifiedTrade[] = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ledger.toLowerCase()) continue;
    let decoded;
    try {
      decoded = decodeEventLog({ abi: LEDGER, data: log.data, topics: log.topics });
    } catch {
      continue; // another PaperLedger event
    }
    const { args } = decoded;
    const asset = ASSETS[args.asset];
    if (!asset) continue;
    const [, answer] = await client.readContract({ address: asset.feed, abi: FEED, functionName: "getRoundData", args: [args.roundId] });
    trades.push({
      bot_id: args.botId.toString(),
      asset: asset.id,
      side: args.buy ? "BUY" : "SELL",
      price_e8: args.priceE8.toString(),
      round_id: args.roundId.toString(),
      oracle_price_e8: answer.toString(),
      matches_oracle: answer === args.priceE8,
      log_index: log.logIndex,
    });
  }
  if (trades.length === 0) return { ...empty("The transaction has no BotFolio trade."), block_number: receipt.blockNumber.toString() };
  return {
    tx_hash: txHash,
    valid: true,
    matches_oracle: trades.every((t) => t.matches_oracle),
    block_number: receipt.blockNumber.toString(),
    trades,
    note: "Settled against QIE's official mainnet oracle. Play money. Not investment advice. No prizes.",
  };
}
