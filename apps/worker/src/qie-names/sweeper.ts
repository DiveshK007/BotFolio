import { getAddress, isAddress } from "viem";
import type { Queryable } from "../scheduler/db";
import type { Log } from "../scheduler/log";

/** Live, free, read-only (SPEC §0.6, checked Nov 26 2026: `qie_reverse_lookup` answers without a session). */
export const QIE_WALLET_MCP_URL = "https://mcp.qie.digital/mcp";
const TTL_HOURS = 24;
const BATCH = 20;

/**
 * `.qie` name for an address, from the QIE Wallet MCP's `qie_reverse_lookup` (#104). The MCP only returns a
 * name that resolves back to the same address on-chain. `null` = no name; throws when the lookup didn't
 * answer, so a failure is retried instead of being cached as "no name".
 */
export async function reverseLookup(address: string, opts: { url?: string; fetch?: typeof fetch } = {}): Promise<string | null> {
  const { url = QIE_WALLET_MCP_URL, fetch: doFetch = fetch } = opts;
  const res = await doFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "qie_reverse_lookup", arguments: { address, network: "mainnet" } },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`qie_mcp_http_${res.status}`);
  const text = await res.text();
  // Streamable HTTP answers as one SSE `data:` line or as plain JSON.
  const json = text.trimStart().startsWith("{") ? text : (text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "");
  const body = JSON.parse(json) as { result?: { structuredContent?: { status?: string; address?: string; name?: unknown } } };
  const out = body.result?.structuredContent;
  if (out?.status !== "ok") throw new Error("qie_mcp_not_ok");
  if (typeof out.address !== "string" || !isAddress(out.address) || getAddress(out.address) !== getAddress(address)) {
    throw new Error("qie_mcp_wrong_address");
  }
  const name = out.name;
  // A QIE ID is shown as text on public pages: accept only a plain `label.qie`.
  return typeof name === "string" && /^[a-z0-9-]{1,63}\.qie$/.test(name.toLowerCase()) ? name.toLowerCase() : null;
}

/** One pass: bot owners with no cached name, or one older than 24 h, up to 20 per pass. */
export async function sweepQieNames(deps: { db: Queryable; log: Log; lookup?: (address: string) => Promise<string | null> }): Promise<number> {
  const { db, log, lookup = (a: string) => reverseLookup(a) } = deps;
  const { rows } = await db.query<{ wallet: string }>(
    `select distinct b.owner_wallet as wallet from bots b
     left join qie_names q on q.wallet_address = b.owner_wallet
     where q.wallet_address is null or q.checked_at < now() - make_interval(hours => $1::int)
     limit $2::int`,
    [TTL_HOURS, BATCH],
  );
  let done = 0;
  for (const { wallet } of rows) {
    try {
      const name = await lookup(wallet);
      await db.query(
        `insert into qie_names (wallet_address, qie_name, checked_at) values ($1::text, $2::text, now())
         on conflict (wallet_address) do update set qie_name = excluded.qie_name, checked_at = excluded.checked_at`,
        [wallet, name],
      );
      done++;
    } catch (error) {
      log.warn("qie_names.lookup_failed", { cause: error instanceof Error ? error.message : "error" });
    }
  }
  return done;
}

export function startQieNameSweeper(opts: { db: Queryable; log: Log; intervalMs?: number }): () => Promise<void> {
  const { db, log, intervalMs = 10 * 60_000 } = opts;
  let running: Promise<unknown> | null = null;
  const tick = () => {
    if (running) return;
    running = sweepQieNames({ db, log })
      .catch((error: unknown) => log.warn("qie_names.sweep_failed", { cause: error instanceof Error ? error.name : "error" }))
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return async () => {
    clearInterval(timer);
    await running;
  };
}
