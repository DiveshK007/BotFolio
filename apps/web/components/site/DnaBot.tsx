"use client";
/**
 * A bot drawn from its DNA (lib/site/dna.ts). Eyes follow the pointer via one shared listener;
 * decorative (aria-hidden). Pass `bot` (uses its latest config hash when given) or an explicit `seed`.
 */
import { reducedMotion } from "./fx";
import { useEffect, useId, useMemo, useRef } from "react";
import { botSeed, dnaSvg, type DnaMood } from "@/lib/dna";

const heads = new Set<HTMLElement>();
let listening = false, px = 0, py = 0, raf = 0;
function frame() {
  raf = 0;
  heads.forEach(el => {
    const r = el.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) return;
    const dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 300) * 4.2;
    el.querySelectorAll<SVGElement>("[data-eye]").forEach(p => (p.style.transform = `translate(${(dx / d) * k}px,${(dy / d) * k}px)`));
  });
}
function listen() {
  if (listening) return;
  listening = true; px = innerWidth / 2; py = innerHeight / 3;
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  addEventListener("pointermove", e => { px = e.clientX; py = e.clientY; kick(); }, { passive: true });
  addEventListener("scroll", kick, { passive: true });
}

type BotLike = { id: number | string; name?: string; personaText?: string; dnaSeed?: string | null };
export function DnaBot({ bot, configHash, seed, hint, version = 1, mood = "smile", size = 40, className, assemble }:
  { bot?: BotLike; configHash?: string; seed?: string; hint?: string; version?: number; mood?: DnaMood; size?: number; className?: string; assemble?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const d = bot ? { seed: bot.dnaSeed || (typeof bot.id === "string" && !/^\d+$/.test(bot.id) ? bot.id : botSeed(bot.id)), hint: `${bot.name ?? ""} ${bot.personaText ?? ""}` } : { seed: seed ?? "botfolio", hint: hint ?? "botfolio mascot" };
  void configHash;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const html = useMemo(() => dnaSvg({ seed: d.seed, hint: d.hint, version, mood, uid }), [d.seed, d.hint, version, mood, uid]);
  useEffect(() => {
    const el = ref.current; if (!el || reducedMotion()) return;
    listen(); heads.add(el); return () => { heads.delete(el); };
  }, []);
  return <span ref={ref} className={`bothead ${assemble ? "assemble" : ""} ${className ?? ""}`} style={{ width: size, height: Math.round(size * 1.033) }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
}
