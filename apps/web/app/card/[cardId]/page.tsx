import type { Metadata } from "next";
import Link from "next/link";
import { CARD_SIZES } from "@botfolio/shared";
import { isRenderedKind } from "@/app/api/card/render";
import { FlipCard } from "@/components/site/interactive";
import { ErrorFallback, StatusBadge } from "@/components/site/ui";
import { getCard } from "@/lib/site/data";
import { SiteHeader } from "@/components/site/SiteHeader";

/** S7 card landing. Its link preview is the card PNG from /api/card/[cardId], for the kinds that route draws. */
export const revalidate = 3600;
type P = { params: Promise<{ cardId: string }> };
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { cardId } = await params; const c = await getCard(cardId);
  const title = c.data ? `${c.data.bot.name}: ${c.data.headline}` : "Verify a card";
  const description = "Every BotFolio card carries its receipts. Flip it to see the transactions on QIE.";
  // Example cards have no PNG (the route only draws real ids); they keep the site-wide image from app/opengraph-image.
  if (c.status !== "live" || !c.data || !isRenderedKind(c.data.kind)) return { title, description };
  const image = { url: `/api/card/${encodeURIComponent(cardId)}`, ...CARD_SIZES.og, alt: title };
  return {
    title, description,
    openGraph: { siteName: "BotFolio", type: "website", title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
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
