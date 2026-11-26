"use client";

import { useId, useState } from "react";
import { displayMoney, displayMoneyDelta, formatMoney, moneyTooltip } from "@/lib/format";

interface MoneyProps {
  /** On-chain value in play USDT, 8 decimals (SPEC §3). */
  valueE8: bigint;
  /** The bot's START_CASH_E8 (PaperLedger). */
  startValueE8: bigint;
  /** Show the change vs start (e.g. "−$12,400") instead of the value. */
  delta?: boolean;
  className?: string;
}

/**
 * A $ play-money figure. $ = 100000 × value / startValue (SPEC §3).
 * The on-chain note is a tap target, not just a hover title, because most users are on phones.
 */
export function Money({ valueE8, startValueE8, delta = false, className = "" }: MoneyProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const dollars = delta ? displayMoneyDelta(valueE8, startValueE8) : displayMoney(valueE8, startValueE8);
  const note = moneyTooltip(delta ? valueE8 - startValueE8 : valueE8);
  return (
    <span className={`relative inline-flex items-baseline gap-1 ${className}`}>
      <span className="tabular-nums" title={note}>
        {formatMoney(dollars, { signed: delta })}
      </span>
      <button
        type="button"
        className="inline-flex size-5 items-center justify-center self-center rounded-full text-[11px] font-semibold text-muted ring-1 ring-line hover:text-ink"
        aria-label="What this $ figure means"
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
