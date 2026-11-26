/**
 * Decodes PaperLedger `Trade` / `ApprovedTrade` logs from a tx receipt (packages/contracts/events.md, frozen),
 * so Verify-any-tx can show the bot, the asset, the oracle round and the price the contract read itself.
 * Only logs emitted by the configured PaperLedger address are decoded: anyone can emit an event called Trade.
 */
import { ASSETS, type AssetId } from "@botfolio/shared";
import { decodeEventLog, type Abi, type Hex } from "viem";
import paperLedgerJson from "../../../../packages/contracts/abi/PaperLedger.json";

const ABI = paperLedgerJson as Abi;

export interface VerifiedTrade {
  botId: string;
  asset: AssetId | null;
  side: "BUY" | "SELL";
  cashE8: string;
  unitsE18: string;
  priceE8: string;
  roundId: string;
  /** The oracle round's updatedAt, ISO. */
  oracleUpdatedAt: string;
  /** true when the owner signed it (ApprovedTrade for the same order in this tx). */
  ownerApproved: boolean;
}

interface Log { address?: string; topics?: Hex[]; data?: Hex }

export function decodeTrades(logs: readonly Log[], paperLedger: string | undefined): VerifiedTrade[] {
  if (!paperLedger || !/^0x[0-9a-fA-F]{40}$/.test(paperLedger)) return [];
  const mine = logs.filter(l => l.address?.toLowerCase() === paperLedger.toLowerCase() && l.topics?.length);
  const trades: (VerifiedTrade & { key: string })[] = [];
  const approved = new Set<string>();
  for (const l of mine) {
    let ev;
    try { ev = decodeEventLog({ abi: ABI, topics: l.topics as [Hex, ...Hex[]], data: l.data ?? "0x" }); } catch { continue; }
    const a = ev.args as unknown as Record<string, unknown>;
    if (ev.eventName === "ApprovedTrade") approved.add(`${a.decisionId}:${a.actionIndex}`);
    if (ev.eventName !== "Trade") continue;
    trades.push({
      key: `${a.decisionId}:${a.actionIndex}`,
      botId: String(a.botId),
      asset: ASSETS.find(x => x.index === Number(a.asset))?.id ?? null,
      side: a.buy ? "BUY" : "SELL",
      cashE8: String(a.cashE8),
      unitsE18: String(a.unitsE18),
      priceE8: String(a.priceE8),
      roundId: String(a.roundId),
      oracleUpdatedAt: new Date(Number(a.updatedAt as bigint) * 1000).toISOString(),
      ownerApproved: false,
    });
  }
  return trades.map(({ key, ...t }) => ({ ...t, ownerApproved: approved.has(key) }));
}
