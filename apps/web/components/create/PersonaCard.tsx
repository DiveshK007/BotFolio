import type { Persona } from "@/lib/persona";

/**
 * The bot card (SPEC §2.1 step 3). Everything here is untrusted (#159): JSX text only, no links, no HTML.
 * <bdi> stops right-to-left characters in a name from reordering the text around it.
 */
export function PersonaCard({ persona }: { persona: Persona }) {
  return (
    <section aria-label="Your bot" className="rounded-r3 border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-r2 bg-accent-soft text-3xl">
          {persona.emoji}
        </span>
        <h2 className="min-w-0 font-display text-2xl font-extrabold leading-tight [overflow-wrap:anywhere]">
          <bdi>{persona.name}</bdi>
        </h2>
      </div>
      <p className="mt-3 [overflow-wrap:anywhere]">
        <bdi>{persona.persona}</bdi>
      </p>
      <h3 className="mt-4 text-xs font-semibold text-muted">How it trades</h3>
      <p className="mt-1 text-sm [overflow-wrap:anywhere]">
        <bdi>{persona.rules}</bdi>
      </p>
    </section>
  );
}
