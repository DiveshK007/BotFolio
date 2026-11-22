import Link from "next/link";
import { BotHead } from "./BotHead";

export function AppHeader() {
  return (
    <header className="mx-auto flex w-full max-w-xl items-center justify-between px-4 py-3">
      <Link href="/" className="inline-flex items-center gap-2 font-display text-lg font-extrabold tracking-tight" aria-label="BotFolio home">
        <BotHead size={28} />
        BotFolio
      </Link>
      <span className="rounded-full bg-sun-soft px-2 py-0.5 text-xs font-semibold text-ink">Play money</span>
    </header>
  );
}
