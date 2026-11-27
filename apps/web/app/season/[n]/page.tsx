import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { SeasonScreen } from "@/components/season/SeasonScreen";

type Props = { params: Promise<{ n: string }> };

// S0 is the hidden test season: it opens here only so its owner can approve the S0 v2 (#385). Owner-only and noindexed, never on the boards.
const SEASON = /^(0|[1-9]\d{0,5})$/;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { n } = await params;
  return SEASON.test(n) ? { title: `Season ${n}`, robots: { index: false } } : { title: "Season not found" };
}

// S5 season close (SPEC §2.3, §2.4): battle result, v2 diff, Approve. Owner-only, so it renders in the browser.
export default async function SeasonPage({ params }: Props) {
  const { n } = await params;
  if (!SEASON.test(n)) notFound();
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-xl px-4 pb-12 pt-2">
        <SeasonScreen n={Number(n)} />
      </main>
    </>
  );
}
