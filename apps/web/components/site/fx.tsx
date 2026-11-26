"use client";
/**
 * Site-wide effects: reduced-motion check (OS setting OR the footer's "Pause all motion"), WebAudio sound
 * effects (muted by default), the footer controls, and privacy-safe analytics events.
 */
import { useEffect, useState } from "react";

export const reducedMotion = () =>
  typeof window !== "undefined" &&
  (matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduce");

/* ---------- sound ---------- */
type SoundName = "tick" | "blip" | "coin" | "sad" | "start" | "win";
let ctx: AudioContext | null = null;
const soundOn = () => { try { return localStorage.getItem("bf-sound") === "1"; } catch { return false; } };
function tone(f: number, d: number, t = 0, type: OscillatorType = "square", g = 0.05) {
  if (!ctx) return;
  const o = ctx.createOscillator(), a = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, ctx.currentTime + t);
  a.gain.setValueAtTime(g, ctx.currentTime + t); a.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + d);
  o.connect(a).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + d + 0.03);
}
const SOUNDS: Record<SoundName, () => void> = {
  tick: () => tone(880, 0.05),
  blip: () => tone(660, 0.05, 0, "triangle"),
  coin: () => { tone(988, 0.08); tone(1319, 0.2, 0.08); },
  sad: () => [392, 370, 349, 311].forEach((f, i) => tone(f, 0.3, i * 0.3, "sawtooth", 0.04)),
  start: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.1, i * 0.09)),
  win: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.12, i * 0.08)),
};
export function sfx(name: SoundName) {
  if (!soundOn()) return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    SOUNDS[name]();
  } catch { /* audio blocked */ }
}

/* ---------- analytics (privacy-safe: no free text, no wallet) ---------- */
type EventName = "persona_preview" | "bot_launch" | "call_run" | "card_saved" | "dc_pick" | "dex_filter" | "talk_sent" | "tour_start" | "verify_tx" | "party_open";
export function track(name: EventName, props: Record<string, string | number | boolean> = {}) {
  try {
    const body = JSON.stringify({ name, props, path: location.pathname });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/site/event", new Blob([body], { type: "application/json" }));
    else void fetch("/api/site/event", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true });
  } catch { /* never block the UI */ }
}

/* ---------- footer controls: sound + pause all motion ---------- */

export function SiteControls() {
  const [sound, setSound] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => { const id = setTimeout(() => { setSound(soundOn()); setPaused(document.documentElement.dataset.motion === "reduce"); }, 0); return () => clearTimeout(id); }, []);
  const flipSound = () => { const v = !sound; setSound(v); try { localStorage.setItem("bf-sound", v ? "1" : "0"); } catch { /* storage blocked */ } if (v) setTimeout(() => sfx("blip"), 0); };
  const flipMotion = () => {
    const v = !paused; setPaused(v);
    if (v) document.documentElement.dataset.motion = "reduce"; else delete document.documentElement.dataset.motion;
    try { localStorage.setItem("bf-motion", v ? "1" : "0"); } catch { /* storage blocked */ }
  };
  const btn = "inline-flex min-h-11 items-center rounded-full border border-line-2 px-4 text-xs font-semibold hover:bg-surface";
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-2">
      <button type="button" className={btn} aria-pressed={sound} onClick={flipSound}>{sound ? "Sound on" : "Sound off"}</button>
      <button type="button" className={btn} aria-pressed={paused} onClick={flipMotion}>{paused ? "Resume motion" : "Pause all motion"}</button>
    </div>
  );
}
