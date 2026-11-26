import { NextResponse } from "next/server";
import { BOT_ID } from "@/lib/bot-record";
import { getBotCards } from "@/lib/site/data";

/** A bot's newest 5 share cards, for /me's "Your cards" (#82). Cards are public at /card/<id>, so no sign-in. */
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const bot = new URL(req.url).searchParams.get("bot") ?? "";
  if (!BOT_ID.test(bot)) return NextResponse.json({ error: "bad_bot" }, { status: 400 });
  try {
    return NextResponse.json({ cards: await getBotCards(bot) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
