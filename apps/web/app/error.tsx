"use client";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { ErrorFallback } from "@/components/site/ui";

/** Any page that throws lands here, inside the root layout, so the ticker and play-money footer stay. */
export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pb-12 pt-2">
        <h1 className="font-display text-2xl font-extrabold">Something went wrong</h1>
        <div className="bf"><ErrorFallback what="This page" source="https://mainnet.qie.digital" /></div>
        <div className="flex flex-wrap gap-4">
          <button type="button" onClick={reset} className="inline-flex min-h-11 items-center font-semibold text-accent-ink">Try again</button>
          <Link href="/" className="inline-flex min-h-11 items-center font-semibold text-accent-ink">Go home</Link>
        </div>
      </main>
    </>
  );
}
