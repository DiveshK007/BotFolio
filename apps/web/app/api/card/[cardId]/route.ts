import { CARD_SIZES, type CardFormat } from "@botfolio/shared";
import { limitByIp, RateLimit } from "@/lib/rate-limit";
import { loadCard } from "../fixtures";
import { isRenderedCard, isRenderedKind, renderCard } from "../render";

// Rendering costs CPU, so the per-IP cap is tighter than /api/v1. CDN hits (immutable, below) never reach it.
const perIp = new RateLimit(30);

function fail(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
}

/** GET /api/card/:cardId[?format=story] → the share card PNG, 1200×630 (default) or 1080×1920 (SPEC §9). */
export async function GET(req: Request, { params }: { params: Promise<{ cardId: string }> }) {
  const limited = limitByIp(req, perIp);
  if (limited) return limited;
  const { cardId } = await params;
  const format = new URL(req.url).searchParams.get("format") ?? "og";
  if (!Object.hasOwn(CARD_SIZES, format)) return fail(400, "BAD_REQUEST", "format is og or story.");
  // Card ids start with their kind (apps/worker/src/cards), so a kind we can't draw is turned away before any lookup.
  if (!isRenderedKind(cardId.split("-")[0]!)) return fail(400, "BAD_REQUEST", "Unknown card kind.");

  const card = await loadCard(cardId);
  if (!card || !isRenderedCard(card)) return fail(404, "NOT_FOUND", "No such card.");
  // A card never changes once written (SPEC §9: immutable per cardId, CDN 1 year).
  return renderCard(card, format as CardFormat, { "cache-control": "public, max-age=31536000, immutable" });
}
