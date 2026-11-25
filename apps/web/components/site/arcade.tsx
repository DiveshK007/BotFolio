"use client";
/** v2 arcade pieces: Flap (split-flap), HoloEffects (foil tilt), Ticker (LED marquee), Arena (race + calls), CustodyTrace. */
import { reducedMotion } from "./fx";
import { useEffect, useRef, useState } from "react";
import type { AssetId } from "@botfolio/shared";
import { DnaBot as BotHead } from "./DnaBot";
import { Badge } from "./ui";
import { short, usd } from "@/lib/site/format";
import type { DnaMood } from "@/lib/dna";

const rm = () => reducedMotion();

/* ---------- Flap: split-flap characters that flip when they change ---------- */
export function Flap({ text, className }: { text: string; className?: string }) {
  // "previous render" pattern: derive the old text during render, no effect needed
  const [cur, setCur] = useState(text);
  const [old, setOld] = useState(text);
  if (text !== cur) { setOld(cur); setCur(text); }
  return (
    <span className={`flap ${className ?? ""}`} role="img" aria-label={text}>
      {[...text].map((ch, i) => (
        <span key={i + ch + (old[i] !== ch ? "f" : "")} aria-hidden="true" className={`${/[0-9A-Za-z₹]/.test(ch) ? "" : "sep"}${old[i] !== ch && !rm() ? " flip" : ""}`} style={{ animationDelay: `${i * 35}ms` }}>{ch === " " ? " " : ch}</span>
      ))}
    </span>
  );
}

/* ---------- HoloEffects: mount once in the site layout; any .holo element tilts with pointer / Android gyro ---------- */
export function HoloEffects() {
  useEffect(() => {
    if (rm()) return;
    const move = (e: PointerEvent) => {
      const h = (e.target as Element)?.closest?.(".holo") as HTMLElement | null; if (!h) return;
      const r = h.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      h.style.setProperty("--mx", `${x * 100}%`); h.style.setProperty("--my", `${y * 100}%`);
      h.style.setProperty("--ry", `${(x - 0.5) * 14}deg`); h.style.setProperty("--rx", `${(0.5 - y) * 12}deg`);
    };
    const out = (e: PointerEvent) => { const h = (e.target as Element)?.closest?.(".holo") as HTMLElement | null; if (h && !h.contains(e.relatedTarget as Node)) { h.style.setProperty("--rx", "0deg"); h.style.setProperty("--ry", "0deg"); } };
    const gyro = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      const ry = Math.max(-12, Math.min(12, e.gamma / 3)), rx = Math.max(-10, Math.min(10, (e.beta - 45) / 4));
      document.querySelectorAll<HTMLElement>(".holo").forEach(h => { h.style.setProperty("--ry", `${ry}deg`); h.style.setProperty("--rx", `${rx}deg`); });
    };
    document.addEventListener("pointermove", move, { passive: true }); document.addEventListener("pointerout", out);
    addEventListener("deviceorientation", gyro);
    return () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerout", out); removeEventListener("deviceorientation", gyro); };
  }, []);
  return null;
}

/* ---------- Ticker: LED marquee of oracle prices ---------- */
export interface TickerItem { asset: AssetId; price: string; roundId: string; ageMin: number; maxAgeMin: number }
export function Ticker({ items, status }: { items: TickerItem[] | null; status: "live" | "example" | "error" }) {
  const row = (aria: boolean) => (
    <span className="row" aria-hidden={aria || undefined}>
      {(items ?? []).map(it => {
        const tone = it.ageMin > it.maxAgeMin ? "grey" : it.ageMin >= 60 ? "amber" : "";
        const age = it.ageMin >= 60 ? `${Math.floor(it.ageMin / 60)}h` : `${Math.max(0, Math.round(it.ageMin))}m`;
        return <span className="ticker-item" key={it.asset}><b>{it.asset}</b><span>{it.price}</span><span className="r">round {it.roundId}</span><span className={`d ${tone}`} /><span className="r">{age} old</span></span>;
      })}
    </span>
  );
  return (
    <div className="ticker" role="region" aria-label="Oracle prices ticker, focus to pause" tabIndex={0}>
      <span className="ticker-label"><span>QIE ORACLE</span>{status === "live" ? <Badge kind="live">LIVE</Badge> : status === "example" ? <Badge kind="example">EXAMPLE</Badge> : null}</span>
      <div className="ticker-track">{status === "error" || !items ? <span className="ticker-item">Oracle prices unavailable right now · check mainnet.qie.digital</span> : <>{row(false)}{row(true)}</>}</div>
    </div>
  );
}

/* ---------- Arena: season race + next-call countdown + "bots are thinking" ---------- */
export interface Racer { id: number | string; name: string; personaText?: string; isHouse?: boolean; owner?: string; ret: number; vol: number; you?: boolean; lines: [string, string] }
function nextSlot() {
  const now = new Date(), ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
  for (const h of [9, 13, 17, 21]) { const t = new Date(ist); t.setHours(h, 0, 0, 0); if (t > ist) return { ms: +t - +ist, label: `${String(h).padStart(2, "0")}:00 IST` }; }
  const t = new Date(ist); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); return { ms: +t - +ist, label: "09:00 IST" };
}
const hms = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, "0")).join(":"); };
const laneX = (r: number) => Math.max(4, Math.min(96, 50 + (r / 14) * 46));

/**
 * status "example": moves are simulated (seeded random walk) and labelled EXAMPLE SIMULATION.
 * status "live": pass real racers each revalidate; the client only animates between server values (no simulation).
 */
/** PetDevice dispatches `bf:launch` with a Racer; the arena adds it as "YOURS". */
export function Arena({ initial, btcSeries, btcRound, status }: { initial: Racer[]; btcSeries: number[]; btcRound: string; status: "live" | "example" }) {
  const [racers, setRacers] = useState<Racer[]>(initial);
  const [series, setSeries] = useState(btcSeries);
  const [slot, setSlot] = useState<{ ms: number; label: string } | null>(null); // set on mount: avoids server/client clock mismatch
  const [calling, setCalling] = useState(false);
  const [bubbles, setBubbles] = useState<Record<string, { text: string; mood: DnaMood } | "dots">>({});
  const box = useRef<HTMLDivElement>(null);
  const runRef = useRef<() => void>(() => {});
  const seed = useRef(1337);
  const rand = () => { seed.current = (seed.current * 16807) % 2147483647; return (seed.current - 1) / 2147483646; };
  useEffect(() => {
    const on = (e: Event) => { const r = (e as CustomEvent<Racer>).detail; setRacers(rs => [r, ...rs.filter(x => !x.you)]); };
    addEventListener("bf:launch", on); return () => removeEventListener("bf:launch", on);
  }, []);
  useEffect(() => {
    let visible = false;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.15 });
    if (box.current) io.observe(box.current);
    const first = setTimeout(() => setSlot(nextSlot()), 0);
    const clock = setInterval(() => { if (!visible) return; const s = nextSlot(); setSlot(s); if (Math.floor(s.ms / 1000) === 0) runRef.current(); /* auto-run at the real slot time */ }, 1000);
    const walk = setInterval(() => {
      if (!visible || calling || rm() || status !== "example") return;
      setRacers(rs => rs.map(r => ({ ...r, ret: Math.max(-14, Math.min(14, r.ret + (rand() - 0.5) * r.vol)) })));
      setSeries(s => [...s.slice(1), s[s.length - 1] * (1 + (rand() - 0.5) * 0.004)]);
    }, 2200);
    return () => { io.disconnect(); clearTimeout(first); clearInterval(clock); clearInterval(walk); };
  }, [calling, status]);
  const runCall = () => {
    if (calling) return; setCalling(true);
    setBubbles(Object.fromEntries(racers.map(r => [String(r.id), "dots" as const])));
    const fast = rm();
    setTimeout(() => {
      const next = racers.map(r => ({ ...r, d: status === "example" ? (rand() - 0.45) * r.vol * 3.2 : 0 }));
      setRacers(next.map(({ d, ...r }) => ({ ...r, ret: Math.max(-14, Math.min(14, r.ret + d)) })));
      setBubbles(Object.fromEntries(next.map(r => [String(r.id), { text: r.d >= 0 ? r.lines[0] : r.lines[1], mood: (r.d > 0.15 ? "proud" : r.d < -0.15 ? "sad" : "think") as DnaMood }])));
    }, fast ? 0 : 1500);
    setTimeout(() => { setBubbles({}); setCalling(false); }, fast ? 2500 : 5200);
  };
  useEffect(() => { runRef.current = runCall; });
  const humans = racers.filter(r => !r.isHouse); const top = humans.reduce((a, r) => (r.ret > a.ret ? r : a), humans[0]);
  const W = 600, H = 120, min = series.length ? Math.min(...series) : 0, max = series.length ? Math.max(...series) : 1, y = (v: number) => H - 14 - ((v - min) / (max - min || 1)) * (H - 40);
  const pts = series.map((v, i) => `${((i / (series.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <div className={`arena ${calling ? "calling" : ""}`} ref={box}>
      <div className="arena-head"><h3>SEASON RACE</h3>
        <div className="slot"><span className="lbl">NEXT CALL</span><Flap text={slot ? hms(slot.ms) : "--:--:--"} /><span className="lbl">AT {slot?.label ?? "…"}</span></div>
        {status === "example" ? <Badge kind="example">EXAMPLE SIMULATION</Badge> : <Badge kind="live">LIVE</Badge>}</div>
      {series.length > 1 && <div className="spark" aria-hidden="true"><svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2B50FF" stopOpacity=".45" /><stop offset="1" stopColor="#2B50FF" stopOpacity="0" /></linearGradient></defs><polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#sg)" /><polyline points={pts} fill="none" stroke="#7C93FF" strokeWidth="2.5" vectorEffect="non-scaling-stroke" /></svg>
        <div className="now"><span>BTC/USDT</span><b>{usd(series[series.length - 1] ?? 0)}</b><span>round {btcRound}{status === "example" ? " · example" : ""}</span></div></div>}
      <ol className="lanes" aria-label="Season return by bot">
        {racers.map(r => { const b = bubbles[String(r.id)]; const x = laneX(r.ret); return (
          <li key={r.id} className={`lane ${r.you ? "you" : ""}`}>
            <div className="who"><b>{r.name}</b>{r.isHouse ? <span className="house">HOUSE</span> : r.you ? <span className="house" style={{ color: "#FF6FA8" }}>YOURS</span> : r.owner ? <span className="mono" style={{ color: "#8C93B8", fontSize: 12 }}>{short(r.owner)}</span> : null}</div>
            <div className="track"><span className={`runner ${x < 30 ? "l" : x > 70 ? "r" : ""}`} style={{ left: `${x}%` }}>
              <BotHead size={54} bot={{ id: r.id, name: r.name, personaText: r.personaText }} mood={b && b !== "dots" ? b.mood : "smile"} />
              {r === top && <span className="crown" aria-label="Top human-raised bot">👑</span>}
              {b && <span className={`think ${b === "dots" ? "dots" : ""}`}>{b === "dots" ? "thinking" : b.text}</span>}
            </span></div>
            <div className={`ret ${r.ret >= 0 ? "up" : "down"}`}>{r.ret >= 0 ? "▲ +" : "▼ −"}{Math.abs(r.ret).toFixed(2)}%</div>
          </li>); })}
      </ol>
      <div className="arena-foot"><span>Centre line = ₹1,00,000. Right of it = up this season.{status === "example" ? " Moves are simulated until the app is live." : ""}</span><button className="btn sun sm" type="button" onClick={runCall} disabled={calling}>{status === "example" ? "Run a call now" : "Replay the last call"}</button></div>
    </div>
  );
}

/* ---------- CustodyTrace: card → tx → block → round → feed, lit one by one ---------- */
export interface CustodyNode { tag: string; title: string; body: React.ReactNode }
export function CustodyTrace({ nodes, run }: { nodes: CustodyNode[]; run: number }) {
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (!run) return;
    const gap = rm() ? 0 : 480; const ts = [setTimeout(() => setLit(0), 0), ...nodes.map((_, i) => setTimeout(() => setLit(i + 1), 250 + i * gap))];
    return () => ts.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);
  return (
    <ol className="custody">
      {nodes.map((n, i) => <li key={n.tag} className={`${i < lit ? "lit" : ""} ${i < lit - 1 ? "done" : ""}`}><span className="node">{n.tag}</span><div><div className="k">{n.title}</div><div className="v">{n.body}</div></div></li>)}
    </ol>
  );
}
