import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { BotPageView } from "@/components/bot/BotPageView";
import { BOT_ID, fetchBotPage } from "@/lib/bot-record";

type Props = { params: Promise<{ botId: string }> };

export const revalidate = 60;

// Only the numeric id goes into metadata: the name is LLM output from user text (#159).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { botId } = await params;
  return BOT_ID.test(botId)
    ? { title: `Bot #${botId}`, description: "Every call with its reason, every trade with its QIE oracle round and tx, every version. Play money." }
    : { title: "Bot not found" };
}

// S4 public bot page (SPEC §2.4). Works logged out: server-rendered from the worker's public GET /bot-page.
export default async function BotPage({ params }: Props) {
  const { botId } = await params;
  if (!BOT_ID.test(botId)) notFound();
  const result = await fetchBotPage(botId);
  if (result.kind === "not_found") notFound();

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-xl px-4 pb-12 pt-2">
        {result.kind === "ok" ? (
          <BotPageView page={result.page} />
        ) : (
          <section className="rounded-r3 border border-line bg-surface p-4 shadow-card">
            <h1 className="font-display text-2xl font-extrabold">{result.kind === "not_live" ? "Bot pages aren't live yet" : "We couldn't load this bot"}</h1>
            <p className="mt-2 text-muted">
              {result.kind === "not_live"
                ? "Every bot gets a public page: holdings, every call with its reason, every trade with its oracle round and tx, versions and trust score. Check back soon."
                : "The record didn't come back. Try again in a minute. Every trade is on QIE mainnet either way."}
            </p>
            <Link href="/" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent-ink">
              Make your own bot
            </Link>
          </section>
        )}
      </main>
    </>
  );
}
