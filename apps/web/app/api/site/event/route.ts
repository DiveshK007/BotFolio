import { NextResponse } from "next/server";

/**
 * Privacy-safe product events (no free text, no wallet, no IP stored). Logged as one JSON line, so they show in
 * Vercel logs and can be drained to any analytics tool later. Unknown names or props are dropped.
 */
const NAMES = new Set(["persona_preview", "bot_launch", "call_run", "card_saved", "dc_pick", "dex_filter", "talk_sent", "tour_start", "verify_tx", "party_open"]);
const PROP = /^[a-z_]{1,20}$/;
export async function POST(req: Request) {
  try {
    const j = (await req.json()) as { name?: string; props?: Record<string, unknown>; path?: string };
    if (!j.name || !NAMES.has(j.name)) return new NextResponse(null, { status: 204 });
    const props = Object.fromEntries(Object.entries(j.props ?? {}).filter(([k, v]) => PROP.test(k) && (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length <= 24))).slice(0, 6));
    console.info(JSON.stringify({ evt: "site", name: j.name, props, path: typeof j.path === "string" ? j.path.slice(0, 60) : null, t: new Date().toISOString() }));
  } catch { /* ignore bad bodies */ }
  return new NextResponse(null, { status: 204 });
}
