/**
 * Required on every page (CLAUDE.md, SPEC §11). Rendered once from the root layout.
 * Do not remove or reword the first line.
 */
export const PLAY_MONEY_LINE = "Play money. Not investment advice. No prizes.";

export function PlayMoneyFooter() {
  return (
    <footer className="border-t border-line bg-surface-2 px-4 py-5 text-center text-sm">
      <p className="font-semibold">{PLAY_MONEY_LINE}</p>
      <p className="mt-1 text-xs text-muted">Settled against QIE&apos;s official mainnet oracle.</p>
    </footer>
  );
}
