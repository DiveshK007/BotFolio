"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { readDraft, saveDraft } from "@/lib/draft";
import { EXAMPLE_SENTENCES, SENTENCE_MAX, checkSentence } from "@/lib/sentence";

/** S1 input (SPEC §2.1 step 1): one sentence + 3 tap-to-fill examples → "Make my bot". */
export function SentenceForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const errorId = useId();

  useEffect(() => {
    // Keep anything typed before hydration; otherwise restore the draft when coming back from S2 to edit.
    setText(inputRef.current?.value || readDraft());
    // Submit stays off until hydrated: a native submit would reload the page and lose the sentence.
    setReady(true);
  }, []);

  function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    const check = checkSentence(text);
    if (!check.ok) {
      setError(check.error);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    saveDraft(check.value);
    router.push("/create");
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
        placeholder="Type how your bot should trade"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        enterKeyHint="go"
        autoComplete="off"
        className="w-full resize-none rounded-r2 border border-line-2 bg-surface px-4 py-3 text-base leading-snug shadow-card placeholder:text-muted focus:border-accent"
      />
      {error && (
        <p id={errorId} role="alert" className="text-sm text-down">
          {error}
        </p>
      )}

      <div role="group" className="flex flex-wrap gap-2" aria-label="Examples">
        {EXAMPLE_SENTENCES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => fill(ex)}
            className="min-h-11 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-left text-sm hover:border-accent hover:text-accent-ink"
          >
            {ex}
          </button>
        ))}
      </div>

      <button
        type="submit"
        disabled={!ready || busy}
        className="mt-1 inline-flex h-12 items-center justify-center rounded-full bg-accent px-6 text-base font-semibold text-on-accent shadow-card transition-transform active:scale-[.98] disabled:opacity-70"
      >
        {busy ? "Opening…" : "Make my bot"}
      </button>
    </form>
  );
}
