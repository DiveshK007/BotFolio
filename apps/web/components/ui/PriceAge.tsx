"use client";

import { useEffect, useState } from "react";
import type { AssetId } from "@botfolio/shared";
import { priceAge, type PriceAgeTone } from "@/lib/format";

const TONE: Record<PriceAgeTone, string> = {
  muted: "text-muted",
  amber: "text-amber bg-amber-soft rounded px-1",
  grey: "text-grey",
};

/** Re-renders every 30 s so the label moves from muted → amber → grey on its own. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * Mandatory price-age label (SPEC §5.7) for every price or mark.
 * `updatedAt` is the oracle round's updatedAt in unix seconds.
 */
export function PriceAge({ asset, updatedAt, className = "" }: { asset: AssetId; updatedAt: number; className?: string }) {
  const now = useNow();
  const label = priceAge(asset, updatedAt, now);
  return (
    // Server and client clocks can differ by a minute at render time; the client value wins.
    <span className={`text-xs ${TONE[label.tone]} ${className}`} suppressHydrationWarning data-tone={label.tone}>
      {label.text}
    </span>
  );
}
