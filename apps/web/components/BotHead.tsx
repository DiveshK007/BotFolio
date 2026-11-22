/** Static bot-head mark (same drawing as app/icon.svg). Decorative. */
export function BotHead({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <line x1="50" y1="14" x2="50" y2="4" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" />
      <circle cx="50" cy="5" r="5" fill="var(--accent)" />
      <rect x="8" y="16" width="84" height="76" rx="24" fill="var(--accent)" />
      <circle cx="35" cy="48" r="11" fill="#fff" />
      <circle cx="65" cy="48" r="11" fill="#fff" />
      <circle cx="35" cy="48" r="5.5" fill="#14161C" />
      <circle cx="65" cy="48" r="5.5" fill="#14161C" />
      <path d="M38 66 Q50 76 62 66" fill="none" stroke="#14161C" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}
