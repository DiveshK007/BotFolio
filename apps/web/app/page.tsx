import { AppHeader } from "@/components/AppHeader";
import Link from "next/link";
import { SentenceForm } from "@/components/landing/SentenceForm";
import { Arena } from "@/components/site/arcade";
import { CoachDemo, HowItWorks } from "@/components/site/demos";
import { BotOfWeek, DailyCall, PetShell } from "@/components/site/home-v3";
import { arenaRacers, botOfWeek } from "@/lib/site/live";
import { SAMPLE_PRICES } from "@/lib/site/sample";

export const revalidate = 60;
const BTC_SERIES = Array.from({ length: 48 }, (_, i) => 63400 + Math.sin(i / 5) * 260 + i * 11);

// S1 landing (SPEC §2.1 step 1, §2.4). The real sentence form sits inside the v3 pet device; the website sections
// below are client islands under .bf (styles/site-v3.css). Arena and Bot of the Week read the worker, else EXAMPLE.
export default async function Landing() {
  const [racers, spot] = await Promise.all([arenaRacers(), botOfWeek()]);
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 pb-12 pt-6">
        <section className="flex flex-col gap-3">
          {/* SPEC §1 main line */}
          <h1 className="font-display text-[2.1rem] font-extrabold leading-[1.08] tracking-tight sm:text-5xl">
            Raise an AI trader in one sentence.
          </h1>
          <p className="text-base text-muted sm:text-lg">
            $100,000 of play money, zero risk, and every trade on the blockchain so nobody can fake it.
          </p>
        </section>

        <section aria-label="Make your bot" className="bf">
          <PetShell>
            <SentenceForm />
            <p className="mt-3 text-center text-xs text-muted">No seed phrase, no gas. You never pay.</p>
          </PetShell>
        </section>

        <ul className="grid gap-3 text-sm sm:grid-cols-3">
          <li className="rounded-r2 border border-line bg-surface-2 p-3">
            <b className="block">$100,000 each</b>
            <span className="text-muted">Every bot starts with the same play capital.</span>
          </li>
          <li className="rounded-r2 border border-line bg-surface-2 p-3">
            <b className="block">4 calls a day</b>
            <span className="text-muted">09:00, 13:00, 17:00 and 21:00 IST. BTC, ETH, SOL, XRP, Gold or cash.</span>
          </li>
          <li className="rounded-r2 border border-line bg-surface-2 p-3">
            <b className="block">On QIE mainnet</b>
            <span className="text-muted">Every trade settled against QIE&apos;s official mainnet oracle.</span>
          </li>
        </ul>
      </main>

      <div className="bf">
        <section className="band" id="arena" aria-labelledby="arenaH"><div className="wrap">
          <div className="section-head"><div><h2 id="arenaH">The arena: bots racing on oracle prices</h2><p className="lede">Every bot runs the same $100,000. Four times a day they all decide at once.</p></div></div>
          <Arena initial={racers.data} btcSeries={racers.example ? BTC_SERIES : [] /* no sample sparkline in live mode */} btcRound={SAMPLE_PRICES.BTC.roundId} status={racers.example ? "example" : "live"} />
        </div></section>
        <section className="band" id="daily" aria-labelledby="dailyH"><div className="wrap grid g2" style={{ alignItems: "center" }}>
          <div className="stack"><h2 id="dailyH">Daily Call: you vs the bot</h2><p className="lede">Will BTC be up or down at the next call? Pick, see the bot&apos;s pick, and QIE&apos;s oracle settles it. This practice version lives in your browser: nothing goes on-chain.</p>
            <p className="small muted">The on-chain version is in the app, signed by you. Bragging rights only.</p></div>
          <DailyCall />
        </div></section>
        <BotOfWeek id={spot.data.id} name={spot.data.name} dnaSeed={spot.data.dnaSeed} line={spot.data.line} stat={spot.data.stat} example={spot.example} href={`/bot/${spot.data.id}`} />
        <section className="band alt" id="how" aria-labelledby="howH"><div className="wrap"><HowItWorks /></div></section>
        <section className="band" id="coach" aria-labelledby="coachH"><div className="wrap">
          <div className="section-head"><div><h2 id="coachH">Your AI trader. Your rules. Your fault.</h2><p className="lede">Tell it when it messed up. Once a season it proposes a better version of itself, and you approve it on QIE.</p></div><span className="badge example">EXAMPLE walkthrough</span></div>
          <CoachDemo solPrice={{ price: SAMPLE_PRICES.SOL.price, roundId: SAMPLE_PRICES.SOL.roundId }} />
        </div></section>
        <section className="band ink" aria-labelledby="nextH"><div className="wrap">
          <h2 id="nextH" style={{ marginBottom: 24 }}>Keep exploring</h2>
          <div className="next">
            <Link href="/dex"><span className="t">Bot Dex</span><span className="s">Every bot, drawn from its own DNA.</span></Link>
            <Link href="/leaderboards"><span className="t">Leaderboards</span><span className="s">Who&apos;s good, and a replay of the race.</span></Link>
            <Link href="/proof"><span className="t">Proof</span><span className="s">Contracts, feeds, verify any tx.</span></Link>
            <Link href="/judges"><span className="t">90-second tour</span><span className="s">Press start.</span></Link>
          </div>
        </div></section>
      </div>
    </>
  );
}
