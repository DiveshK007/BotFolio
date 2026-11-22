"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { EXAMPLE_SENTENCES, SENTENCE_MAX, checkSentence } from "@/lib/sentence";

/**
 * S1 input (SPEC §2.1 step 1): one sentence + 3 tap-to-fill examples → "Make my bot".
 * The sentence travels to /create in the query string; /create treats it as untrusted text (#159).
 */
export function SentenceForm({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const errorId = useId();

  function submit(e?: { preventDefault(): void }) {
    e?.preventDefault();
    const check = checkSentence(text);
    if (!check.ok) {
      setError(check.error);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    router.push(`/create?s=${encodeURIComponent(check.value)}`);
  }

  // One sentence: Enter submits instead of adding a newline.
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  }

  function fill(example: string) {
    setText(example);
    setError(null);
    inputRef.current?.focus();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <label htmlFor={inputId} className="text-sm font-semibold">
        Describe your bot in one sentence
      </label>
      <textarea
        id={inputId}
        ref={inputRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={onKeyDown}
        rows={2}
        maxLength={SENTENCE_MAX + 40 /* let them overshoot a bit, then explain */}
        placeholder="e.g. Careful like my dad, loves gold"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        enterKeyHint="go"
        autoComplete="off"
        className="w-full resize-none rounded-r2 border border-line-2 bg-surface px-4 py-3 text-base leading-snug shadow-card placeholder:text-muted focus:border-accent focus:outline-none"
      />
      {error && (
        <p id={errorId} role="alert" className="text-sm text-down">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2" aria-label="Examples">
        {EXAMPLE_SENTENCES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => fill(ex)}
            className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-left text-sm hover:border-accent hover:text-accent-ink"
          >
            {ex}
          </button>
        ))}
      </div>

      <button
        type="submit"
        disabled={busy}
        className="mt-1 inline-flex h-12 items-center justify-center rounded-full bg-accent px-6 text-base font-semibold text-on-accent shadow-card transition-transform active:scale-[.98] disabled:opacity-70"
      >
        {busy ? "Opening…" : "Make my bot"}
      </button>
    </form>
  );
}
