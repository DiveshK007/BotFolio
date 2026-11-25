import { NextResponse } from "next/server";
import { rpc } from "@/lib/site/oracle";

/**
 * Verify-any-tx (proof page): is this tx on QIE mainnet, which block, and was it sent to a BotFolio contract?
 * Decoding the TradeExecuted event into round id + price is a follow-up once the ABIs are frozen (packages/contracts/events.md).
 */
export const dynamic = "force-dynamic";
const CONTRACTS: [string, string | undefined][] = [
  ["BotForwarder", process.env.NEXT_PUBLIC_FORWARDER_ADDRESS], ["BotRegistry", process.env.NEXT_PUBLIC_BOT_REGISTRY_ADDRESS],
  ["PaperLedger", process.env.NEXT_PUBLIC_PAPER_LEDGER_ADDRESS], ["SeasonLedger", process.env.NEXT_PUBLIC_SEASON_LEDGER_ADDRESS],
  ["TrustScoreRegistry", process.env.NEXT_PUBLIC_TRUST_REGISTRY_ADDRESS], ["DailyCall", process.env.NEXT_PUBLIC_DAILY_CALL_ADDRESS],
  ["Challenges", process.env.NEXT_PUBLIC_CHALLENGES_ADDRESS],
];
export async function GET(req: Request) {
  const tx = new URL(req.url).searchParams.get("tx") ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return NextResponse.json({ ok: false, error: "bad_hash" }, { status: 400 });
  try {
    const [t, rc] = await Promise.all([
      rpc<{ to: string | null; blockNumber: string | null } | null>("eth_getTransactionByHash", [tx]),
      rpc<{ status: string; logs: unknown[]; blockNumber: string } | null>("eth_getTransactionReceipt", [tx]),
    ]);
    if (!t) return NextResponse.json({ ok: true, found: false });
    const to = t.to?.toLowerCase() ?? null;
    const contract = CONTRACTS.find(([, a]) => a && to && a.toLowerCase() === to)?.[0] ?? null;
    return NextResponse.json({
      ok: true, found: true, to: t.to, contract,
      block: t.blockNumber ? BigInt(t.blockNumber).toString() : "pending",
      status: rc ? (rc.status === "0x1" ? "success" : "reverted") : "pending",
      logs: rc?.logs?.length ?? 0,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "rpc_unreachable" }, { status: 502 });
  }
}
