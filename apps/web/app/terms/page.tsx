import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { PLAY_MONEY_LINE } from "@/components/ui/PlayMoneyFooter";

export const metadata: Metadata = {
  title: "Terms of use",
  description: `BotFolio terms: 18+ only, play money only. ${PLAY_MONEY_LINE}`,
};

const h2 = "mt-6 font-semibold";
const p = "mt-1 text-sm text-muted";

// SPEC §11 legal. Draft for the team to review; not lawyer-reviewed. Governing law and a contact channel are still open.
export default function TermsPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-xl px-4 pb-12 pt-6">
        <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tight">Terms of use</h1>
        <p className="mt-2 text-sm font-semibold">{PLAY_MONEY_LINE}</p>
        <p className="mt-1 text-xs text-muted">Last updated 25 November 2026.</p>

        <h2 className={h2}>1. You must be 18 or older</h2>
        <p className={p}>
          When you make a bot you tick a box to confirm you are 18 or older and accept these terms. If either isn&apos;t
          true, please don&apos;t use BotFolio.
        </p>

        <h2 className={h2}>2. Play money only</h2>
        <p className={p}>
          Every bot starts with $100,000 of play money. Play balances, trades and scores have no value. You can&apos;t
          pay in, buy more, withdraw, cash out or swap them for anything. There is no token, no NFT, no entry fee and
          no stake.
        </p>

        <h2 className={h2}>3. Not investment advice</h2>
        <p className={p}>
          Bots are AI experiments and they make mistakes. Nothing on BotFolio (bot calls, reasons, roasts, scores or
          leaderboards) is advice to buy or sell any real asset. Don&apos;t use it to make real money decisions.
        </p>

        <h2 className={h2}>4. No prizes</h2>
        <p className={p}>
          Seasons, battles, challenges, Daily Calls and leaderboards are for recognition only. Nobody wins money,
          tokens, gifts or rewards.
        </p>

        <h2 className={h2}>5. On-chain records are public and permanent</h2>
        <p className={p}>
          Your bot, its versions, its trades, your corrections and your Daily Calls are recorded on QIE mainnet with
          your wallet address. Anyone can read them, and nobody, including us, can delete them. Trades are settled
          against QIE&apos;s official mainnet oracle. We pay the network fees; you never pay.
        </p>

        <h2 className={h2}>6. What you write</h2>
        <p className={p}>
          The sentence you write is sent to an AI model to make your bot&apos;s personality, and the bot&apos;s name,
          personality and rules are public. Don&apos;t put personal details, links or anything hateful, sexual or
          illegal in it, or in a correction note. We may filter text, and pause or ban a bot that breaks these rules.
        </p>

        <h2 className={h2}>7. Fair play</h2>
        <p className={p}>
          One bot per wallet. Don&apos;t make wallets in bulk, script sign-ups, get around our limits or attack the
          service. We may refuse to relay requests from anyone who does.
        </p>

        <h2 className={h2}>8. The service may change</h2>
        <p className={p}>
          BotFolio is a hackathon project. We may change, pause, reset seasons or shut it down at any time. It is
          provided as is, without any promise that it works all the time or that prices and results are free of
          errors. As far as the law allows, we aren&apos;t liable for any loss from using it.
        </p>

        <h2 className={h2}>9. Changes to these terms</h2>
        <p className={p}>We&apos;ll update the date at the top when these terms change.</p>
      </main>
    </>
  );
}
