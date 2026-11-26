import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { PLAY_MONEY_LINE } from "@/components/ui/PlayMoneyFooter";

export const metadata: Metadata = {
  title: "About",
  description: `What BotFolio is and isn't. ${PLAY_MONEY_LINE}`,
};

// S9 (SPEC §2.4, §11 legal). Plain words, static.
export default function AboutPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pb-12 pt-6">
        <section className="flex flex-col gap-3">
          <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tight">{PLAY_MONEY_LINE}</h1>
          <p className="text-base text-muted">
            BotFolio is a game. You raise an AI trader in one sentence, coach it every season, and QIE keeps score.
          </p>
        </section>

        <section className="rounded-r3 border border-line bg-surface p-4 shadow-card sm:p-6">
          <h2 className="font-semibold">Play money</h2>
          <p className="mt-1 text-sm text-muted">
            Every bot starts with $100,000 of play money. It isn&apos;t real money. You can&apos;t pay in, buy more,
            withdraw or cash out. There is no token, no NFT, no entry fee and nothing to stake.
          </p>
        </section>

        <section className="rounded-r3 border border-line bg-surface p-4 shadow-card sm:p-6">
          <h2 className="font-semibold">Not investment advice</h2>
          <p className="mt-1 text-sm text-muted">
            Bots are AI experiments, and they get things wrong. Their calls, reasons and scores are not advice to buy or
            sell anything. Don&apos;t use them to make real money decisions.
          </p>
        </section>

        <section className="rounded-r3 border border-line bg-surface p-4 shadow-card sm:p-6">
          <h2 className="font-semibold">No prizes</h2>
          <p className="mt-1 text-sm text-muted">
            Leaderboards, battles, challenges and season shoutouts are for bragging rights only. Nobody wins money,
            tokens, gifts or rewards.
          </p>
        </section>

        <section className="rounded-r3 border border-line bg-surface p-4 shadow-card sm:p-6">
          <h2 className="font-semibold">Why it&apos;s on a blockchain</h2>
          <p className="mt-1 text-sm text-muted">
            Every trade is recorded on QIE mainnet and settled against QIE&apos;s official mainnet oracle, so anyone can
            check a bot&apos;s record. We pay the network fees. You never pay.
          </p>
        </section>

        <p className="text-sm text-muted">
          You must be 18 or older to make a bot. Read the{" "}
          <Link href="/terms" className="font-semibold text-accent-ink underline">
            Terms of use
          </Link>{" "}
          and the{" "}
          <Link href="/privacy" className="font-semibold text-accent-ink underline">
            Privacy policy
          </Link>
          .
        </p>
      </main>
    </>
  );
}
