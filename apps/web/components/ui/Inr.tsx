"use client";

import { useEffect, useId, useState } from "react";
import { displayInr, displayInrDelta, formatInr, inrTooltip } from "@/lib/format";
import { loadUsdInr } from "@/lib/usd-inr";

interface InrProps {
  /** On-chain value in play USDT, 8 decimals (SPEC §3). */
  valueE8: bigint;
  /** The bot's START_CASH_E8 (PaperLedger). */
  startValueE8: bigint;
  /** Show the change vs start (e.g. "−₹12,400") instead of the value. */
  delta?: boolean;
  className?: string;
}

/**
 * A ₹ play-money figure. ₹ = 100000 × value / startValue (SPEC §3).
 * The "≈ X USDT; INR conversion approximate" note is a tap target, not just a hover title, because most users are on phones.
 */
export function Inr({ valueE8, startValueE8, delta = false, className = "" }: InrProps) {
  const [open, setOpen] = useState(false);
  const [usdInr, setUsdInr] = useState<number | null>(null);
  const id = useId();
  useEffect(() => {
    let live = true;
    void loadUsdInr().then((rate) => live && setUsdInr(rate));
    return () => {
      live = false;
    };
  }, []);
  const rupees = delta ? displayInrDelta(valueE8, startValueE8) : displayInr(valueE8, startValueE8);
  const note = inrTooltip(delta ? valueE8 - startValueE8 : valueE8, usdInr);
  return (
    <span className={`relative inline-flex items-baseline gap-1 ${className}`}>
      <span className="tabular-nums" title={note}>
        {formatInr(rupees, { signed: delta })}
      </span>
      <button
        type="button"
        className="inline-flex size-5 items-center justify-center self-center rounded-full text-[11px] font-semibold text-muted ring-1 ring-line hover:text-ink"
        aria-label="What this ₹ figure means"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        i
      </button>
      <span
        id={id}
        role="note"
        hidden={!open}
        className="absolute left-0 top-full z-10 mt-1 w-max max-w-[16rem] rounded-r1 border border-line bg-surface px-2 py-1 text-xs font-normal text-muted shadow-card"
      >
        {note}. Play money.
      </span>
    </span>
  );
}
