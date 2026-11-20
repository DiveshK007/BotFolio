# Product demo video: master brief

## Inputs
- Product name: BotFolio (capital F)
- Repo / codebase: https://github.com/DiveshK007/BotFolio. Source of truth: `SPEC.md` (v1.1) and `CLAUDE.md` at the repo root.
- One-line pitch: "Raise an AI trader in one sentence, coach it every season, and let QIE keep score."
- Brand: derive from the repo
- Real footage: [folder of screen recordings and screenshots — to be added after the Nov 26–27 season runs on mainnet; "none" until then]
- Where it will be shown: QIE Hackathon 3.0 submission form (demo video), demo week (Dec 1–5), X, YouTube
- Deadline: final video by Nov 28 2026; hackathon submission closes 23:59 CET Nov 30 2026 (04:29 IST Dec 1)
- Voice: pick one, offer samples

## Goal
Make two videos of the same product, in the same style, with the same voice:
1. A 60–90 s pitch for socials and the hackathon form.
2. A 3–5 min explainer: how it works, step by step, with real proof.

## Rule zero: honesty
- Every claim in the script must trace to something in the repo: docs, proof files, tests, logs, contract state, or real footage. Keep a claims table (claim → source file/line or tx hash) and show it to me before rendering.
- Follow the repo's own wording rules if it has any (PROOF, CONTRIBUTING, CLAUDE.md).
- Label scenes: "REAL FOOTAGE" for recordings, "ANIMATED" for designed features that aren't shipped. Never present a concept as live.
- If a beat I asked for has no footage or proof, say so and offer a stand-in built from real data (a log, a tx list). Don't fake it.

## Phase 1 · Discover (read before writing anything)
- Read the docs, proof/verification files, the handoff and plan files, the env var lists, the main entry points, and any real logs (server logs, jsonl, test output).
- List: what the product does, who it's for, the core loop, what's live vs simulated vs not built, real numbers (prices, counts, hashes, ids), and the brand assets (logos, sprites, icons, fonts, colours).
- Footage: make contact sheets of every recording (ffmpeg, one tile every few seconds) and look at them. Note which clip shows which beat, with timestamps and screen regions worth zooming into.
- Check which tools install and which hosts are reachable before planning around them.

## Phase 2 · Script and storyboard
Structure for the pitch (about 90 s):
cold open on the problem (5 s) → name + one-line promise (5 s) → the core interaction (10–15 s) → onboarding/setup moment → the business or value loop → 3–5 fast feature beats → trust/privacy promises → end card with the repo URL and event tag.

Structure for the explainer (3–5 min):
hook (3D or bold motion open) → the problem → the product live → real footage of a run → "how it works" step-by-step diagram (one card per step, 4–6 steps) → real proof scenes built from actual data (transactions, log entries, verify output, numbers moving) → why it can be trusted → feature montage → stack ("built on …") → end card.

Write the voiceover as short spoken lines, each with a start time and a hard "must end by" time. Speaking rate: about 2.5 words/s. Show me the script and claims table, then continue unless I object.

## Phase 3 · Build
Use the right tool per scene and say which skill each scene uses:
- **Motion design rules:** load the LottieFiles motion-design skill. Pick one personality (playful / precise / calm) and keep it: entrance durations, easing (ease-out-back for playful), stagger, overshoot. Shape moves first, content follows.
- **Assembly:** Remotion (React) as the timeline. Load the remotion-dev skills. One Sequence per scene; scene list and VO lines in one timeline.json so timing lives in one place.
- **3D:** Three.js via @remotion/three for the hero open (camera push into the product, the mascot/product reveal). Rapier (@dimforge/rapier3d-compat) for physics: confetti, coins, falling objects. Pre-simulate deterministically, then look up positions per frame, so every render is identical.
- **2D choreography:** GSAP timelines, seeked per frame, for cards, counters and diagram builds.
- **Diagrams:** Manim if it installs; otherwise HTML/SVG cards rendered in Remotion.
- **Real footage:** cut clips at high resolution, place them in a framed window, animate zooms with keyframes [time, scale, focusX, focusY] onto the part that matters. Speed up waits 4–8×. Lower-third label on every clip.
- **Proof scenes:** build them from real data: transaction lists with hashes and status, log entries with the important fields highlighted, terminal "verify" output typed out, meters that move with the real numbers.
- **Transitions:** coloured skewed swipes, 0.5 s, in brand colours.
- **Captions:** word-by-word captions with @remotion/captions, active word in the accent colour, 4–6 words per page, split at line boundaries.

## Phase 4 · Voice and sound
- **Voice:** best offline neural TTS available (Kokoro ONNX first; Piper as a fallback). If its models aren't reachable directly, try npm/PyPI-bundled models or a linked machine. Render 3–4 candidate voices on the same line and let me pick. Spell acronyms out for the TTS ("T E E").
- Fit each line to its window by raising the speed only as far as needed, capped at 1.3×. Flag every line above 1.15× and offer shorter wording instead.
- Trim lead and tail silence gently (keep about 40 ms before the first sound so soft onsets survive).
- **Word timings:** faster-whisper (or whisperX) word timestamps; fall back to spreading by word length when the transcript doesn't match.
- **Music:** an original bed (synthesised, or a licensed/CC0 track from Openverse if reachable) that thins out under footage.
- **SFX:** a cue on every visual beat (pop, tick, whoosh, coin, impact), kept in a cues list with times.
- **Mix:** duck music about 9 dB and SFX about 4 dB under the voice, soft limiter, target about −14 to −16 LUFS.
- I'll say if I'd rather record the voice myself; then cut my take per line automatically and place it at the same start times.

## Phase 5 · Render
- Embed fonts (base64 or FontFace with delayRender), or the renderer silently falls back to serif.
- For WebGL scenes, release delayRender only after the first frame has actually drawn.
- Render in resumable chunks (about 450 frames each) with a capped video cache and retries, then concat, so one crash doesn't cost the whole render.
- H.264, 1080p30, faststart. Make a small copy (CRF ~24) for uploading.

## Phase 6 · Check (before telling me it's done)
- Contact sheet of the whole video (one tile every 5–7 s), and look at it: overlaps, clipped text, wrong zoom targets, stray UI (screenshot overlays, notifications).
- Run speech-to-text over the final mix and compare every line with the script; fix lines it mishears (rephrase, or respell for the TTS).
- Loudness and peak check.
- Re-check the claims table against the final cut.
- Tell me plainly what you couldn't check (you can't listen, so say so) and what's still missing.

## Phase 7 · Deliver
- Both videos (full + small copies) in the repo's media folder, never committed if they're over 10 MB.
- Post copy: X caption under 280 characters, YouTube title and description for each video, all using only claims from the claims table.
- The source (Remotion project, timeline.json, VO and audio scripts) zipped, so wording and timing can change later without starting over.
- A one-line list of every skill/tool used and which ones were skipped and why.

Work through the phases in order. Ask me only if a choice is expensive to redo or the repo contradicts itself; otherwise decide, say what you decided, and keep going.
