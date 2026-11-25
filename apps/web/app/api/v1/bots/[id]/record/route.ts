import { BOT_ID, fetchBotPage, REVALIDATE_S } from "@/lib/bot-record";
import { toPublicRecord } from "@/lib/public-record";

// Public, read-only, no sign-in: anyone (another site, an agent) may read it, so CORS is open and no cookies are read.
// name, persona and reason are LLM output from user text (#159); served only as JSON strings, never as HTML.
const BASE_HEADERS = { "access-control-allow-origin": "*", "x-content-type-options": "nosniff" };

function fail(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status, headers: { ...BASE_HEADERS, "cache-control": "no-store" } });
}

/** GET /api/v1/bots/:id/record → the bot's public record, same payload as MCP get_bot_record (docs/public-api.md). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!BOT_ID.test(id)) return fail(400, "BAD_REQUEST", "The bot id is a positive integer.");

  const result = await fetchBotPage(id);
  switch (result.kind) {
    case "ok":
      return Response.json(toPublicRecord(result.page), {
        headers: { ...BASE_HEADERS, "cache-control": `public, s-maxage=${REVALIDATE_S}, stale-while-revalidate=${REVALIDATE_S * 5}` },
      });
    case "not_found":
      return fail(404, "NOT_FOUND", "No such bot.");
    case "not_live":
      return fail(503, "NOT_LIVE", "Bot records aren't switched on yet.");
    default:
      return fail(502, "UPSTREAM_ERROR", "The record didn't come back. Try again in a minute.");
  }
}
