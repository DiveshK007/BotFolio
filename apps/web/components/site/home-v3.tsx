"use client";
/** Home v3: PetShell (wraps the real SentenceForm), DailyCall practice (real oracle), BotOfWeek, WatchParty. */
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { sentenceSeed, type DnaMood } from "@/lib/dna";
import { DnaBot } from "./DnaBot";
import { Flap } from "./arcade";
import { reducedMotion, sfx, track } from "./fx";

/* ---------- next decision slot (09/13/17/21 IST) ---------- */
export function nextSlot(now = new Date()) {
  const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
  for (const h of [9, 13, 17, 21]) { const t = new Date(ist); t.setHours(h, 0, 0, 0); if (t > ist) return { ms: +t - +ist, at: new Date(now.getTime() + (+t - +ist)), label: `${String(h).padStart(2, "0")}:00 IST` }; }
  const t = new Date(ist); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0);
  return { ms: +t - +ist, at: new Date(now.getTime() + (+t - +ist)), label: "09:00 IST" };
}

/* ---------- PetShell: the device around the real sentence form ---------- */
const LINES = ["Hi. I watch prices so you don't have to. Poke me.", "I trade play money. Your real money stays exactly where it is.", "Four calls a day. I have opinions at every one of them.", "Tell me when I mess up. I take notes. On-chain ones.", "Not advice. Just vibes and oracle prices."];
const bucket = (s: string) => (/gold|careful|safe/i.test(s) ? "gold" : /btc|bitcoin|yolo|maxi/i.test(s) ? "btc" : /dip|sol|xrp/i.test(s) ? "dip" : /eth/i.test(s) ? "eth" : "other");

export function PetShell({ children }: { children: ReactNode }) {
  const [seed, setSeed] = useState("botfolio"); const [hint, setHint] = useState("botfolio mascot");
  const [mood, setMood] = useState<DnaMood>("smile"); const [bubble, setBubble] = useState(LINES[0]); const [i, setI] = useState(0);
  const [assemble, setAssemble] = useState(false); const [sleeping, setSleeping] = useState(false); const [wob, setWob] = useState(0);
  const typed = useRef(""); const [hasTyped, setHasTyped] = useState(false); const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined); const shake = useRef({ dir: 0, x: 0, flips: [] as number[] }); const sent = useRef(false);
  useEffect(() => {
    let idle: ReturnType<typeof setTimeout>;
    const arm = () => { clearTimeout(idle); idle = setTimeout(() => { setSleeping(true); setMood("sleep"); setBubble("Zzz… wake me at the next call."); }, 30000); };
    const wake = () => { setSleeping(s => { if (s) { setMood("o"); setBubble("Huh? I was watching the oracle. With my eyes closed."); setTimeout(() => setMood("smile"), 600); } return false; }); arm(); };
    arm(); (["pointerdown", "keydown", "scroll"] as const).forEach(ev => addEventListener(ev, wake, { passive: true }));
    return () => { clearTimeout(idle); (["pointerdown", "keydown", "scroll"] as const).forEach(ev => removeEventListener(ev, wake)); };
  }, []);
  const onInput = (e: React.FormEvent<HTMLDivElement>) => {
    const el = e.target as HTMLInputElement | HTMLTextAreaElement; if (!("value" in el)) return;
    const v = el.value.trim(); clearTimeout(t.current);
    t.current = setTimeout(() => {
      if (!v) { typed.current = ""; setHasTyped(false); setSeed("botfolio"); setHint("botfolio mascot"); setBubble(LINES[0]); return; }
      const first = !typed.current; typed.current = v; setHasTyped(true);
      setSeed(sentenceSeed(v)); setHint(v); setMood("smile");
      if (first && !reducedMotion()) { setAssemble(true); setTimeout(() => setAssemble(false), 1400); }
      setBubble("That's me? I like it. Press the button and I'm born on QIE.");
      if (!sent.current && v.length > 8) { sent.current = true; track("persona_preview", { kind: bucket(v), len: Math.min(120, v.length) }); }
    }, 280);
  };
  const onShake = (e: React.PointerEvent) => {
    if (reducedMotion()) return; const s = shake.current, dx = e.clientX - s.x; s.x = e.clientX; if (Math.abs(dx) < 14) return;
    const d = Math.sign(dx), now = Date.now(); if (d !== s.dir) { s.dir = d; s.flips = s.flips.filter(x => now - x < 900); s.flips.push(now); }
    if (s.flips.length >= 7) { s.flips = []; setMood("dizzy"); setBubble("Whoa. Stop. I'm a trader, not a cocktail."); setWob(w => w + 1); setTimeout(() => setMood("smile"), 1800); }
  };
  const poke = () => { const n = (i + 1) % LINES.length; setI(n); setBubble(LINES[n]); setMood("o"); setWob(w => w + 1); sfx("blip"); setTimeout(() => setMood(m => (m === "o" ? "smile" : m)), 380); };
  return (
    <div className="device" onInput={onInput} onPointerMove={onShake}>
      <div className="device-top"><span>BOTFOLIO · PET-01</span><span className="lights" aria-hidden="true"><i className="on" /><i /><i /></span></div>
      <div className="screen">
        <div className="screen-bar"><span>{hasTyped ? "YOUR BOT (PREVIEW)" : "BOTFOLIO"}</span><span>MOOD <span className="meter" aria-hidden="true">{[0, 1, 2, 3, 4].map(k => <i key={k} className={k < 3 ? "on" : ""} />)}</span></span></div>
        <div className="pet-stage">
          <p className="pet-bubble" aria-live="polite">{bubble}</p>
          <button className={`pet bob ${wob ? "wobble" : ""}`} key={wob} type="button" aria-label="Poke the bot" onClick={poke}>
            <DnaBot size={170} seed={seed} hint={hint} mood={mood} assemble={assemble} />
          </button>
          <div className="pet-shadow" aria-hidden="true" />
          {sleeping && <span className="zzz" aria-hidden="true">z z</span>}
        </div>
        <div className="lcd"><span>The look comes from your sentence. Your bot keeps this DNA when it&apos;s born.</span></div>
      </div>
      <div className="device-form">{children}</div>
    </div>
  );
}

/* ---------- Daily Call practice: real oracle prices, local only ---------- */
interface Btc { price: number; roundId: string; updatedAt: string }
interface Pick { pick: "up" | "down"; bot: "up" | "down"; price: number; roundId: string; settleAt: string; result?: { dir: "up" | "down"; pct: string; price: number; roundId: string } }
const KEY = "bf-dc-v1";
export function DailyCall() {
  const [btc, setBtc] = useState<Btc | null | "error">(null); const [p, setP] = useState<Pick | null>(null); const [streak, setStreak] = useState(0); const [now, setNow] = useState(() => Date.now());
  const load = async () => { try { const r = await fetch("/api/site/btc", { cache: "no-store" }); if (!r.ok) throw new Error(); const j = (await r.json()) as Btc; setBtc(j); return j; } catch { setBtc("error"); return null; } };
  useEffect(() => { const first = setTimeout(() => { void load(); try { const s = JSON.parse(localStorage.getItem(KEY) || "{}"); if (s.p) setP(s.p); if (s.streak) setStreak(s.streak); } catch { /* none */ } }, 0); const id = setInterval(() => setNow(Date.now()), 1000); return () => { clearTimeout(first); clearInterval(id); }; }, []);
  const save = (np: Pick | null, ns = streak) => { setP(np); setStreak(ns); try { localStorage.setItem(KEY, JSON.stringify({ p: np, streak: ns })); } catch { /* storage blocked */ } };
  const choose = (pick: "up" | "down") => {
    if (!btc || btc === "error") return; const slot = nextSlot();
    save({ pick, bot: (slot.label.charCodeAt(0) + slot.label.charCodeAt(1)) % 2 ? "up" : "down", price: btc.price, roundId: btc.roundId, settleAt: slot.at.toISOString() });
    sfx("blip"); track("dc_pick", { pick });
  };
  const settle = async () => {
    if (!p) return; const j = await load(); if (!j) return;
    if (j.roundId === p.roundId) return; // no new round yet: keep waiting, never guess
    const dir = j.price >= p.price ? "up" : "down", won = p.pick === dir;
    save({ ...p, result: { dir, pct: (((j.price - p.price) / p.price) * 100).toFixed(2), price: j.price, roundId: j.roundId } }, won ? streak + 1 : 0);
    sfx(won ? "win" : "sad");
  };
  const due = p && !p.result && now >= Date.parse(p.settleAt);
  const left = p && !p.result ? Math.max(0, Date.parse(p.settleAt) - now) : 0;
  const hms = (ms: number) => { const s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, "0")).join(":"); };
  const arrow = (d: "up" | "down") => (d === "up" ? "▲ UP" : "▼ DOWN");
  return (
    <div className="dc device">
      <div className="screen"><div className="screen-bar"><span>DAILY CALL · BTC · PRACTICE</span><span>STREAK {streak}</span></div>
        <div className="dc-body" aria-live="polite">
          {btc === null && <p>Reading QIE&apos;s BTC feed…</p>}
          {btc === "error" && <p>Can&apos;t reach QIE&apos;s oracle right now, so no call. Try again in a bit.</p>}
          {btc && btc !== "error" && !p && <p><b>BTC is ${btc.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</b> (oracle round {btc.roundId}). Up or down by the next call?</p>}
          {p && !p.result && <><p>You: <b>{arrow(p.pick)}</b> · Bot: <b>{arrow(p.bot)}</b> · from ${p.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
            {due ? <button className="btn sm" type="button" onClick={settle} style={{ marginTop: 8 }}>Check the oracle</button> : <p className="small">Settles in {hms(left)} against QIE&apos;s oracle.</p>}</>}
          {p?.result && <><p>BTC went <b className={p.result.dir === "up" ? "up" : "down"}>{p.result.dir === "up" ? "▲" : "▼"} {p.result.pct}%</b> (round {p.result.roundId})</p>
            <p><b>{p.pick === p.result.dir && p.bot !== p.result.dir ? "You beat the bot." : p.bot === p.result.dir && p.pick !== p.result.dir ? "The bot got you this time." : p.pick === p.result.dir ? "You both called it." : "You both missed."}</b></p>
            <button className="btn sm" type="button" onClick={() => save(null)} style={{ marginTop: 8 }}>New call</button></>}
        </div></div>
      <div className="btns" style={{ marginTop: 14 }}>
        <button className="abtn a" type="button" disabled={!!p && !p.result} aria-pressed={p?.pick === "up" && !p.result} onClick={() => choose("up")}><span aria-hidden="true">▲</span>UP</button>
        <button className="abtn b" type="button" disabled={!!p && !p.result} aria-pressed={p?.pick === "down" && !p.result} onClick={() => choose("down")}><span aria-hidden="true">▼</span>DOWN</button>
      </div>
    </div>
  );
}

/* ---------- Bot of the Week ---------- */
export function BotOfWeek({ id, name, dnaSeed, line, stat, example, href }: { id: string | number; name: string; dnaSeed?: string | null; line: string; stat: string; example: boolean; href: string }) {
  return (
    <section className="spot" aria-labelledby="spotH">
      <div className="wrap spot-grid">
        <div className="spot-stage" aria-hidden="true"><div className="cone" /><span className="spot-bot"><DnaBot size={220} bot={{ id, name, dnaSeed }} version={2} mood="proud" /></span><div className="spot-floor" /></div>
        <div className="stack"><p className="pixel" style={{ color: "#FFC93C" }}>BOT OF THE WEEK</p><h2 id="spotH" style={{ color: "#fff" }}>{name}</h2>
          <p style={{ color: "#C9CEDA" }}>{line}</p><p className="mono" style={{ color: "#3DDC97" }}>{stat}</p>
          <div className="row">{example && <span className="badge example">EXAMPLE</span>}<span className="small" style={{ color: "#9AA0AD" }}>A shoutout. That&apos;s the whole trophy.</span></div>
          <div className="row"><Link className="btn sun" href={href}>See its record</Link></div></div>
      </div>
    </section>
  );
}

/* ---------- Watch party: banner 5 minutes before each call ---------- */
export function WatchParty() {
  const [now, setNow] = useState<number | null>(null); const [open, setOpen] = useState(false);
  useEffect(() => { const first = setTimeout(() => setNow(Date.now()), 0); const id = setInterval(() => setNow(Date.now()), 1000); return () => { clearTimeout(first); clearInterval(id); }; }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, []);
  if (now === null) return null;
  const s = nextSlot(new Date(now)), sec = Math.floor(s.ms / 1000);
  if (s.ms > 5 * 60000) return null;
  const txt = `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  return (
    <div className="bf">
      <div className="party-bar"><span className="pixel">LIVE CALL IN</span><Flap text={txt} /><button className="btn sun sm" type="button" onClick={() => { setOpen(true); sfx("start"); track("party_open"); }}>Watch it live</button></div>
      {open && <div className="party" role="dialog" aria-modal="true" aria-labelledby="partyTitle"><div className="party-in"><div className="party-head"><p className="pixel" id="partyTitle">WATCH PARTY · {s.label}</p><Flap text={txt} /><span className="small">Every bot decides at once. Results land on the leaderboard a minute after the call.</span><button className="btn ghost sm" type="button" onClick={() => setOpen(false)} style={{ color: "#fff", borderColor: "#3A4060" }} autoFocus>Close</button></div>
        <div className="row"><Link className="btn sun" href="/#arena" onClick={() => setOpen(false)}>Open the arena</Link><Link className="btn ghost" href="/leaderboards" onClick={() => setOpen(false)} style={{ color: "#fff", borderColor: "#3A4060" }}>Leaderboards</Link></div></div></div>}
    </div>
  );
}
