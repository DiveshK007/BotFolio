"use client";

import { useId } from "react";
import { PER_COIN_PCT, TRADES_PER_DAY, type BotLimits } from "@/lib/persona";

interface SliderProps {
  label: string;
  value: number;
  range: { min: number; max: number; step: number };
  format: (n: number) => string;
  disabled: boolean;
  onChange: (n: number) => void;
}

function Slider({ label, value, range, format, disabled, onChange }: SliderProps) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
        </label>
        <output htmlFor={id} className="font-mono tabular-nums">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        {...range}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="block h-11 w-full accent-accent"
      />
      <div aria-hidden="true" className="flex justify-between text-xs text-muted">
        <span>{format(range.min)}</span>
        <span>{format(range.max)}</span>
      </div>
    </div>
  );
}

/** The 2 sliders, pre-set by the persona call (SPEC §2.1 step 3). */
export function LimitSliders({
  limits,
  disabled,
  onChange,
}: {
  limits: BotLimits;
  disabled: boolean;
  onChange: (limits: BotLimits) => void;
}) {
  return (
    <section aria-label="Limits" className="flex flex-col gap-4 rounded-r3 border border-line bg-surface p-4 shadow-card">
      <Slider
        label="Max per coin"
        value={limits.maxPerCoinPct}
        range={PER_COIN_PCT}
        format={(n) => `${n}%`}
        disabled={disabled}
        onChange={(maxPerCoinPct) => onChange({ ...limits, maxPerCoinPct })}
      />
      <Slider
        label="Max trades per day"
        value={limits.maxTradesPerDay}
        range={TRADES_PER_DAY}
        format={String}
        disabled={disabled}
        onChange={(maxTradesPerDay) => onChange({ ...limits, maxTradesPerDay })}
      />
    </section>
  );
}
