import { explorerAddress, explorerTx } from "@botfolio/shared";
import { isAddress, isTxHash, shortHex } from "@/lib/format";

type ExplorerLinkProps =
  | { tx: string; address?: never; label?: string }
  | { address: string; tx?: never; label?: string };

const chip =
  "inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-1 font-mono text-xs";

/**
 * Explorer-link chip → https://mainnet.qie.digital (SPEC §5.5).
 * Anything that isn't a well-formed tx hash / address (pending, example data) renders as plain text, never a link.
 */
export function ExplorerLink(props: ExplorerLinkProps) {
  const value = props.tx ?? props.address ?? "";
  const valid = props.tx !== undefined ? isTxHash(value) : isAddress(value);
  const text = props.label ?? shortHex(value);

  if (!valid) {
    return (
      <span className={`${chip} text-muted`} title="Not on chain yet">
        {text || "pending"}
      </span>
    );
  }
  const href = props.tx !== undefined ? explorerTx(value) : explorerAddress(value);
  return (
    <a
      className={`${chip} text-accent-ink hover:border-accent`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${text}, view on QIE explorer (opens in a new tab)`}
    >
      <span className="truncate">{text}</span>
      <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 4h6v6" />
        <path d="M20 4 10 14" />
        <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
      </svg>
    </a>
  );
}
