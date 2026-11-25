import Link from "next/link";

/**
 * Required on every page (CLAUDE.md, SPEC §11). Rendered once from the root layout.
 * Do not remove or reword the first line.
 */
export const PLAY_MONEY_LINE = "Play money. Not investment advice. No prizes.";

const LINKS = [
  ["/about", "About"],
  ["/terms", "Terms of use"],
  ["/privacy", "Privacy"],
] as const;

export function PlayMoneyFooter() {
  return (
    <footer className="border-t border-line bg-surface-2 px-4 py-5 text-center text-sm">
      <p className="font-semibold">{PLAY_MONEY_LINE}</p>
      <p className="mt-1 text-xs text-muted">Settled against QIE&apos;s official mainnet oracle.</p>
      <nav aria-label="About and legal" className="mt-2 flex justify-center gap-4 text-xs">
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className="inline-flex min-h-11 items-center text-muted underline hover:text-ink">
            {label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
