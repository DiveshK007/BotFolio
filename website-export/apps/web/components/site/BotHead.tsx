"use client";
/**
 * BotFolio's mascot: a geometric bot head whose eyes follow the pointer.
 * One shared pointer listener for every head on the page; decorative (aria-hidden).
 */
import { useEffect, useRef } from "react";

type Mood = "smile" | "sad" | "o";
const heads = new Set<SVGSVGElement>();
let listening = false, px = 0, py = 0, raf = 0;
function frame() {
  raf = 0;
  heads.forEach(svg => {
    const r = svg.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) return;
    const dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 300) * 4.2;
    svg.querySelectorAll<SVGCircleElement>("[data-eye]").forEach(p => (p.style.transform = `translate(${(dx / d) * k}px,${(dy / d) * k}px)`));
  });
}
function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true; px = innerWidth / 2; py = innerHeight / 3;
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  addEventListener("pointermove", e => { px = e.clientX; py = e.clientY; kick(); }, { passive: true });
  addEventListener("scroll", kick, { passive: true });
}

export function BotHead({ color = "#2B50FF", emoji, mood = "smile", size = 40, className }: { color?: string; emoji?: string; mood?: Mood; size?: number; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    listen(); heads.add(el);
    return () => { heads.delete(el); };
  }, []);
  const mouth = mood === "sad" ? "M38 72 Q50 64 62 72" : mood === "o" ? "M46 70 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0" : "M38 66 Q50 76 62 66";
  return (
    <span className={`bothead ${className ?? ""}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg ref={ref} viewBox="0 0 100 100" focusable="false">
        <line x1="50" y1="14" x2="50" y2="4" stroke={color} strokeWidth="5" strokeLinecap="round" />
        <circle cx="50" cy="5" r="5" fill={color} />
        <rect x="8" y="16" width="84" height="76" rx="24" fill={color} stroke="rgba(0,0,0,.18)" strokeWidth="2" />
        <rect x="18" y="28" width="64" height="52" rx="16" fill="rgba(255,255,255,.18)" />
        <circle cx="35" cy="48" r="11" className="eye" /><circle cx="65" cy="48" r="11" className="eye" />
        <circle cx="35" cy="48" r="5.5" className="pupil" data-eye="1" /><circle cx="65" cy="48" r="5.5" className="pupil" data-eye="1" />
        <path d={mouth} fill="none" stroke="#14161C" strokeWidth="4.5" strokeLinecap="round" />
      </svg>
      {emoji ? <span className="emo">{emoji}</span> : null}
    </span>
  );
}
