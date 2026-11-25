import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { BotPageView } from "@/components/bot/BotPageView";
import { BOT_ID, bpsPct, fetchBotPage } from "@/lib/bot-record";
import { Evolution, ShareCardButton, TalkToBot, TrustGauge } from "@/components/site/extras";
import { botSeed } from "@/lib/dna";

type Props = { params: Promise<{ botId: string }> };

export const revalidate = 60;

const FAILED = {
  not_live: {
    title: "Bot pages aren't live yet",
    text: "Every bot gets a public page: holdings, every call with its reason, every trade with its oracle round and tx, versions and trust score. Check back soon.",
  },
  busy: { title: "Lots of people are looking", text: "Too many requests right now. Try again in a minute. Every trade is on QIE mainnet either way." },
  error: { title: "We couldn't load this bot", text: "The record didn't come back. Try again in a minute. Every trade is on QIE mainnet either way." },
};

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
          <>
            <BotPageView page={result.page} />
            {/* v3: DNA evolution, trust gauge, talk to the bot, share card. All from the same public record. */}
            <div className="bf" style={{ display: "grid", gap: 20, marginTop: 24 }}>
              <Evolution botId={result.page.bot.id} name={result.page.bot.name} dnaSeed={result.page.bot.dna_seed} versions={result.page.versions} />
              {result.page.trust && <div className="card"><div className="block-head"><h3>Trust score</h3></div><TrustGauge total={result.page.trust.total} f={[result.page.trust.fRules, result.page.trust.fDrawdown, result.page.trust.fConsistency, result.page.trust.fExplains]} /></div>}
              <TalkToBot botId={result.page.bot.id} name={result.page.bot.name} dnaSeed={result.page.bot.dna_seed} />
              <div className="row"><ShareCardButton label="Save this bot's card" title={result.page.bot.name} line={result.page.bot.persona.slice(0, 110)} stat={result.page.seasons[0] ? `${bpsPct(result.page.seasons[0].return_bps)} this season` : ""} seed={result.page.bot.dna_seed || botSeed(result.page.bot.id)} hint={`${result.page.bot.name} ${result.page.bot.persona}`} example={false} /></div>
            </div>
          </>
        ) : (
          <section className="rounded-r3 border border-line bg-surface p-4 shadow-card">
            <h1 className="font-display text-2xl font-extrabold">{FAILED[result.kind].title}</h1>
            <p className="mt-2 text-muted">{FAILED[result.kind].text}</p>
            <Link href="/" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent-ink">
              Make your own bot
            </Link>
          </section>
        )}
      </main>
    </>
  );
}
