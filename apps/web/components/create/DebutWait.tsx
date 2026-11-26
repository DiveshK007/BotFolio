"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchBotPage, type BotPageResult } from "@/lib/bot-record";
import { getWorkerUrl } from "@/lib/config";

const POLL_MS = 3_000;
/** The runner's debut normally lands within a slot or two; after this, stop polling and just link the page. */
export const DEBUT_WAIT_MS = 90_000;

/** The indexer has the bot and the runner has made its first call (a trade, or a hold if prices were stale). */
export const debutLanded = (r: BotPageResult) => r.kind === "ok" && (r.page.trades.length > 0 || r.page.decisions.length > 0);

/**
 * After createBot (SPEC §2.1 step 5): poll the worker until the debut call is in, then open the bot page,
 * which shows it. Polled from the browser with no-store, so the bot page's 60 s cache never holds a "not found".
 */
export function DebutWait({ botId }: { botId: string }) {
  const router = useRouter();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const workerUrl = getWorkerUrl();
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const noStore: typeof fetch = (url, init) => fetch(url, { ...init, cache: "no-store" });

    async function poll() {
      const result = await fetchBotPage(botId, workerUrl, noStore);
      if (stopped) return;
      if (debutLanded(result)) return router.push(`/bot/${botId}`);
      if (Date.now() - started > DEBUT_WAIT_MS) return setSlow(true);
      timer = setTimeout(poll, POLL_MS);
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [botId, router]);

  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="text-sm">
        {slow
          ? "Its first trade is taking longer than usual (QIE prices may be a few minutes old). It will show on your bot page."
          : "Your bot is making its first trade…"}
      </p>
      {/* No prefetch: a prefetched page from before the indexer saw the bot would be a cached "not found". */}
      <Link
        href={`/bot/${botId}`}
        prefetch={false}
        className="inline-flex h-12 items-center justify-center rounded-full bg-accent px-6 font-semibold text-on-accent"
      >
        Open your bot page
      </Link>
    </div>
  );
}
