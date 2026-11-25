import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";

export default function BotNotFound() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-xl px-4 pb-12 pt-2">
        <section className="rounded-r3 border border-line bg-surface p-4 shadow-card">
          <h1 className="font-display text-2xl font-extrabold">No bot with that id</h1>
          <p className="mt-2 text-muted">It may not exist yet, or the link has a typo. Bot ids are numbers, like /bot/12.</p>
          <Link href="/" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent-ink">
            Make your own bot
          </Link>
        </section>
      </main>
    </>
  );
}
