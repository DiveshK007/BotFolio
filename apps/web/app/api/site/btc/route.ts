import { NextResponse } from "next/server";
import { readOracle } from "@/lib/site/oracle";

/** Live BTC/USDT from QIE's oracle for Daily Call practice. Errors are errors: no cached or made-up price. */
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const [r] = await readOracle(["BTC"], 0);
    return NextResponse.json({ price: Number(BigInt(r.answerE8) / 10_000n) / 10_000, roundId: r.roundId, updatedAt: new Date(r.updatedAt * 1000).toISOString() }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "oracle_unreachable" }, { status: 502 });
  }
}
