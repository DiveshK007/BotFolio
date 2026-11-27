import Link from "next/link";
import { SiteControls } from "@/components/site/fx";

/**
 * Required on every page (CLAUDE.md, SPEC §11). Rendered once from the root layout.
 * Do not remove or reword the first line.
 */
export const PLAY_MONEY_LINE = "Play money. Not investment advice. No prizes.";

const LINKS = [
  ["/leaderboards", "Leaderboards"],
  ["/dex", "Bot Dex"],
  ["/proof", "Proof"],
  ["/judges", "For judges"],
  ["/developers", "Developers"],
  ["/about", "About"],
  ["/terms", "Terms of use"],
  ["/privacy", "Privacy"],
] as const;

/** An https feedback form or group (#182 stopgap, master plan B7), or null: the link stays hidden until it's set. */
export function feedbackUrl(raw: string | undefined): string | null {
  return raw && /^https:\/\/\S+$/.test(raw.trim()) ? raw.trim() : null;
}

const FEEDBACK = feedbackUrl(process.env.NEXT_PUBLIC_FEEDBACK_URL);

export function PlayMoneyFooter({ feedback = FEEDBACK }: { feedback?: string | null }) {
  return (
    <footer className="border-t border-line bg-surface-2 px-4 py-5 text-center text-sm">
      <p className="font-semibold">{PLAY_MONEY_LINE}</p>
      <p className="mt-1 text-xs text-muted">Settled against QIE&apos;s official mainnet oracle.</p>
      <nav aria-label="Site and legal" className="mt-2 flex flex-wrap justify-center gap-x-4 text-xs">
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className="inline-flex min-h-11 items-center text-muted underline hover:text-ink">
            {label}
          </Link>
        ))}
        {feedback && (
          <a href={feedback} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-muted underline hover:text-ink">
            Feedback
          </a>
        )}
      </nav>
      <SiteControls />
    </footer>
  );
}
