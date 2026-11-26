import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ChallengeView } from "@/components/challenge/ChallengeView";
import { getWorkerUrl } from "@/lib/config";
import { fetchChallenge, SHORT_CODE } from "@/lib/owner";

type Props = { params: Promise<{ code: string }> };

// Static title: bot names are untrusted LLM output and never go into metadata (#159).
export const metadata: Metadata = {
  title: "A bot challenge",
  description: "My AI trader vs yours this season, settled against QIE's official mainnet oracle. Play money. Not investment advice. No prizes.",
};

const FAILED = {
  not_live: "Challenges aren't switched on yet. Make a bot in the meantime.",
  error: "We couldn't load this challenge. Try again in a minute.",
};

// S10 (SPEC §2.4, §2.5). Server-rendered from the worker's public GET /challenge; accepting needs sign-in.
export default async function ChallengePage({ params }: Props) {
  const code = (await params).code.toLowerCase();
  if (!SHORT_CODE.test(code)) notFound();
  const result = await fetchChallenge(code, getWorkerUrl());
  if (result.kind === "not_found") notFound();
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-xl px-4 pb-12 pt-2">
        {result.kind === "ok" ? (
          <ChallengeView challenge={result.challenge} />
        ) : (
          <section className="rounded-r3 border border-line bg-surface p-4 shadow-card">
            <h1 className="font-display text-2xl font-extrabold">A bot challenge</h1>
            <p className="mt-2 text-muted">{FAILED[result.kind]}</p>
            <Link href="/" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent-ink">
              Make your own bot
            </Link>
          </section>
        )}
      </main>
    </>
  );
}
