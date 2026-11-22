import type { ReactNode } from "react";
import type { AssetId } from "@botfolio/shared";
import { explorerTx } from "@botfolio/shared";
import { priceAge, short } from "@/lib/site/format";
import { isExampleHash } from "@/lib/site/sample";
import type { DataStatus } from "@/lib/site/types";

type BadgeKind = "example" | "live" | "coming" | "verified" | "house" | "new" | "ph";
export function Badge({ kind, children, title }: { kind: BadgeKind; children: ReactNode; title?: string }) {
  return <span className={`badge ${kind}`} title={title}>{children}</span>;
}

/** The label every data block carries. */
export function StatusBadge({ status, exampleText = "EXAMPLE" }: { status: DataStatus; exampleText?: string }) {
  if (status === "live") return <Badge kind="live">LIVE</Badge>;
  if (status === "example") return <Badge kind="example">{exampleText}</Badge>;
  if (status === "notlive") return <Badge kind="coming">NOT LIVE YET</Badge>;
  return null;
}

/** Visible placeholder for a missing fact. Never invent the value. */
export const Placeholder = ({ children }: { children: ReactNode }) => <span className="ph-text">[{children}]</span>;

export function PriceAge({ asset, ageMin }: { asset: AssetId; ageMin: number }) {
  const a = priceAge(asset, ageMin);
  return <span className={`age ${a.tone === "muted" ? "" : a.tone}`}>{a.text}</span>;
}

const ICONS = {
  ext: <><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>,
  warn: <><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17v.5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  pen: <><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="m13 7 4 4" /></>,
  bot: <><rect x="4" y="7" width="16" height="13" rx="4" /><path d="M12 7V3" /><circle cx="9" cy="13" r="1.4" fill="currentColor" /><circle cx="15" cy="13" r="1.4" fill="currentColor" /></>,
  oracle: <><path d="M3 17l5-6 4 3 6-8 3 4" /><path d="M3 21h18" /></>,
  coach: <><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /><path d="M9 11h6M9 14h4" /></>,
  chain: <><rect x="3" y="8" width="8" height="8" rx="2" /><rect x="13" y="8" width="8" height="8" rx="2" /><path d="M11 12h2" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  play: <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />,
} as const;
export type IconName = keyof typeof ICONS;
export function Icon({ name, size, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  );
}

/** Explorer link chip. EXAMPLE hashes never link out. */
export function TxChip({ hash, label }: { hash: string; label?: string }) {
  if (isExampleHash(hash))
    return <span className="tx" aria-disabled="true" tabIndex={0} title="Example hash. Links to the explorer once live.">{label ?? short(hash)}</span>;
  return <a className="tx" href={explorerTx(hash)} target="_blank" rel="noopener">{label ?? short(hash)} <Icon name="ext" /></a>;
}

export function Note({ tone, children }: { tone?: "warn" | "err"; children: ReactNode }) {
  return <div className={`note ${tone ?? ""}`} role={tone === "err" ? "alert" : undefined}><Icon name={tone ? "warn" : "info"} />{children}</div>;
}

/** Shared fallback when a live fetch fails: keep the section, point to the chain. */
export function ErrorFallback({ what, source }: { what: string; source: string }) {
  return (
    <Note tone="err">
      <div><b>{what} can&apos;t load right now.</b> The record itself lives on QIE mainnet, so you can still check it on the{" "}
        <a href={source.startsWith("http") ? source : "https://mainnet.qie.digital"} target="_blank" rel="noopener">explorer</a>. We won&apos;t show estimates instead.</div>
    </Note>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="card" aria-busy="true">{Array.from({ length: lines }, (_, i) => <span key={i} className="skel" style={{ margin: "14px 0", width: `${90 - i * 12}%` }} />)}</div>;
}
