import { AppHeader } from "@/components/AppHeader";
import { SentenceForm } from "@/components/landing/SentenceForm";

// S1 landing (SPEC §2.1 step 1, §2.4). Static page: one small client island (the form), no data fetching, so it loads fast on 4G.
export default function Landing() {
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
            ₹1 lakh of play money, zero risk, and every trade on the blockchain so nobody can fake it.
          </p>
        </section>

        <section aria-label="Make your bot" className="rounded-r3 border border-line bg-surface p-4 shadow-card sm:p-6">
          <SentenceForm />
          <p className="mt-3 text-center text-xs text-muted">Sign in with a passkey. No seed phrase, no gas.</p>
        </section>

        <ul className="grid gap-3 text-sm sm:grid-cols-3">
          <li className="rounded-r2 border border-line bg-surface-2 p-3">
            <b className="block">₹1,00,000 each</b>
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
    </>
  );
}
