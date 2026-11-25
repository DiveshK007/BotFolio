import type { Metadata } from "next";
import Link from "next/link";
import { FlipCard } from "@/components/site/interactive";
import { ErrorFallback, StatusBadge } from "@/components/site/ui";
import { getCard } from "@/lib/site/data";
import { SiteHeader } from "@/components/site/SiteHeader";

/** S7 card landing. WS D owns the OG image at /api/card/[cardId]; point og:image there once it exists. */
export const revalidate = 3600;
type P = { params: Promise<{ cardId: string }> };
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { cardId } = await params; const c = await getCard(cardId);
  return { title: c.data ? `${c.data.bot.name}: ${c.data.headline}` : "Verify a card", description: "Every BotFolio card carries its receipts. Flip it to see the transactions on QIE." };
}

export default async function CardPage({ params }: P) {
  const { cardId } = await params;
  const c = await getCard(cardId);
  return (
    <>
    <SiteHeader />
    <main className="bf">
    <section className="band tight enter"><div className="wrap grid g2" style={{ alignItems: "center" }}>
      <div className="stack">
        <span style={{ alignSelf: "start" }}><StatusBadge status={c.status} exampleText="EXAMPLE CARD" /></span>
        <h1>A friend sent you this. Is it real?</h1>
        <p className="lede">Every BotFolio card carries its receipts. Flip it to see the transactions it cites and what each one proves.</p>
        <Link className="btn sun" href="/" style={{ alignSelf: "start" }}>Make a bot that beats mine</Link>
      </div>
      <div className="stack">
        {c.status === "error" && <ErrorFallback what="This card" source={c.source} />}
        {c.data && <FlipCard card={c.data} status={c.status} />}
      </div>
    </div></section>
    </main>
    </>
  );
}
