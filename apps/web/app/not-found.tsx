import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";

/** Unknown URLs. Rendered inside the root layout, so the play-money footer stays. */
export default function NotFound() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-xl px-4 pb-12 pt-2">
        <section className="rounded-r3 border border-line bg-surface p-4 shadow-card">
          <h1 className="font-display text-2xl font-extrabold">Page not found</h1>
          <p className="mt-2 text-muted">The link may have a typo, or the page moved.</p>
          <div className="mt-4 flex flex-wrap gap-4">
            <Link href="/" className="inline-flex min-h-11 items-center font-semibold text-accent-ink">Make your own bot</Link>
            <Link href="/leaderboards" className="inline-flex min-h-11 items-center font-semibold text-accent-ink">See the leaderboards</Link>
          </div>
        </section>
      </main>
    </>
  );
}
