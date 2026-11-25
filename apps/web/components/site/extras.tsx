"use client";
/** v3 extras: Bot Dex grid, season race replay, talk to a bot, share-card PNG, judges attract mode, verify any tx, bot page evolution + trust gauge. */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { botSeed, dnaSvg, dnaTraits } from "@/lib/dna";
import { DnaBot } from "./DnaBot";
import type { VerifiedTrade } from "@/lib/site/verify";
import { e8ToNumber, priceDecimals, usd } from "@/lib/site/format";
import { reducedMotion, sfx, track } from "./fx";

/* ================= Bot Dex ================= */
export interface DexBot { id: string; name: string; persona?: string; isHouse?: boolean; returnPct?: number | null; version?: number }
const LABEL: Record<string, string> = { square: "Boxy", round: "Round", capsule: "Capsule", tv: "TV", egg: "Egg", visor: "Visor", cyclops: "Cyclops", sleepy: "Sleepy", ball: "Ball antenna", bolt: "Lightning", sprout: "Sprout", coil: "Coil", twin: "Twin antennas", none: "None", chain: "Gold chain", ears: "Wolf ears", headphones: "Headphones", glasses: "Glasses", bow: "Bow", cap: "Cap", scarf: "Scarf", band: "Doctor band", blush: "Blush", stripes: "Stripes", spots: "Spots" };
const GROUPS: [keyof Omit<ReturnType<typeof dnaTraits>, "pal" | "version" | "pat">, string, string[]][] = [
  ["body", "Body", ["square", "round", "capsule", "tv", "egg"]], ["eyes", "Eyes", ["round", "visor", "cyclops", "sleepy"]],
  ["ant", "Antenna", ["ball", "bolt", "sprout", "coil", "twin", "none"]], ["acc", "Extra", ["chain", "ears", "headphones", "glasses", "bow", "cap", "scarf", "band", "none"]],
];
const pctTxt = (n: number) => `${n > 0 ? "▲ +" : n < 0 ? "▼ −" : ""}${Math.abs(n).toFixed(2)}%`;
export function DexGrid({ bots, example }: { bots: DexBot[]; example: boolean }) {
  const [f, setF] = useState<Record<string, string | null>>({ body: null, eyes: null, ant: null, acc: null });
  const [q, setQ] = useState(""); const [open, setOpen] = useState<DexBot | null>(null);
  const withTraits = useMemo(() => bots.map(b => ({ b, t: dnaTraits(botSeed(b.id), `${b.name} ${b.persona ?? ""}`, b.version ?? 1) })), [bots]);
  const list = withTraits.filter(({ b, t }) => GROUPS.every(([k]) => !f[k] || t[k] === f[k]) && (!q || b.name.toLowerCase().includes(q.toLowerCase())));
  const ot = open ? dnaTraits(botSeed(open.id), `${open.name} ${open.persona ?? ""}`, open.version ?? 1) : null;
  return (
    <>
      <div className="dex-filters">
        <label className="sr" htmlFor="dexQ">Search bots</label><input className="inp" id="dexQ" placeholder="Search by name" value={q} onChange={e => setQ(e.target.value)} />
        {GROUPS.map(([k, label, opts]) => <div className="dex-group" role="group" aria-label={label} key={k}><span className="pixel small">{label.toUpperCase()}</span>
          {opts.map(o => <button key={o} type="button" className="chip" aria-pressed={f[k] === o} onClick={() => { setF(x => ({ ...x, [k]: x[k] === o ? null : o })); sfx("tick"); track("dex_filter", { group: k, value: o }); }}>{LABEL[o]}</button>)}</div>)}
        <button type="button" className="btn ghost sm" onClick={() => { setF({ body: null, eyes: null, ant: null, acc: null }); setQ(""); }}>Clear filters</button>
      </div>
      <p className="small muted" aria-live="polite" style={{ margin: "10px 0 16px" }}>{list.length} of {bots.length} bots {example && <span className="badge example">EXAMPLE BOTS</span>}</p>
      <ul className="dex">
        {list.length ? list.map(({ b }) => (
          <li key={b.id}><button type="button" className="dex-card" onClick={() => { setOpen(b); sfx("blip"); }}>
            <DnaBot size={86} bot={{ id: b.id, name: b.name, personaText: b.persona }} version={b.version ?? 1} /><b>{b.name}</b>
            {typeof b.returnPct === "number" && <span className={`small ${b.returnPct >= 0 ? "up" : "down"}`}>{pctTxt(b.returnPct)}</span>}
            {b.isHouse && <span className="badge house">HOUSE</span>}{(b.version ?? 1) >= 2 && <span className="badge new">v{b.version}</span>}</button></li>
        )) : <li className="dex-empty"><p><b>No bot has that combo yet.</b> Yours could be the first.</p><Link className="btn sm" href="/">Make one</Link></li>}
      </ul>
      {open && ot && (
        <div className="party" role="dialog" aria-modal="true" aria-labelledby="dexName" onClick={e => e.target === e.currentTarget && setOpen(null)}>
          <div className="dex-modal" style={{ display: "block", position: "relative" }}>
            <div className="dex-big holo"><DnaBot size={160} bot={{ id: open.id, name: open.name, personaText: open.persona }} version={open.version ?? 1} mood="proud" /></div>
            <h2 id="dexName" style={{ marginTop: 14 }}>{open.name}</h2>
            <ul className="traits">{([["Body", ot.body], ["Eyes", ot.eyes], ["Antenna", ot.ant], ["Extra", ot.acc], ["Pattern", ot.pat]] as const).map(([k, v]) => <li key={k}><span>{k}</span><b>{LABEL[v] ?? v}</b></li>)}</ul>
            <div className="row" style={{ marginTop: 14 }}><Link className="btn sm" href={`/bot/${open.id}`}>Open its page</Link><ShareCardButton title={open.name} line="One of a kind, drawn from its own DNA." stat={typeof open.returnPct === "number" ? `${pctTxt(open.returnPct)} this season` : ""} seed={botSeed(open.id)} hint={`${open.name} ${open.persona ?? ""}`} example={example} /><button className="btn ghost sm" type="button" onClick={() => setOpen(null)} autoFocus>Close</button></div>
          </div>
        </div>
      )}
    </>
  );
}

/* ================= Season race replay ================= */
export interface RaceSeries { id: string; name: string; isHouse?: boolean; points: number[] /* return % at each mark */ }
export function RaceReplay({ series, labels, example }: { series: RaceSeries[]; labels: string[]; example: boolean }) {
  const last = labels.length - 1; const [i, setI] = useState(last); const [play, setPlay] = useState(false); const ROW = 54;
  useEffect(() => { if (!play) return; const id = setInterval(() => setI(x => { if (x >= last) { setPlay(false); return x; } sfx("tick"); return x + 1; }), reducedMotion() ? 400 : 1000); return () => clearInterval(id); }, [play, last]);
  const ranked = series.map((s, k) => ({ k, v: s.points[i] ?? 0 })).sort((a, b) => b.v - a.v); const rank = new Map(ranked.map((r, n) => [r.k, n]));
  return (
    <div className="race card">
      <div className="block-head"><div className="row"><h3>Season, call by call</h3>{example && <span className="badge example">EXAMPLE DATA</span>}</div><span className="pixel small" aria-live="polite">{labels[i]}</span></div>
      <div className="race-rows" style={{ height: series.length * ROW }}>
        {series.map((s, k) => { const v = s.points[i] ?? 0; return (
          <div key={s.id} className="race-row" style={{ transform: `translateY(${(rank.get(k) ?? 0) * ROW}px)` }}>
            <DnaBot size={40} bot={{ id: s.id, name: s.name }} /><span className="race-name">{s.name}{s.isHouse && <> <span className="badge house">HOUSE</span></>}</span>
            <span className="race-bar"><i className={v >= 0 ? "pos" : "neg"} style={{ width: `${Math.max(2, Math.min(100, ((v + 14) / 28) * 100))}%` }} /></span>
            <span className="race-val mono">₹{Math.round(100000 * (1 + v / 100)).toLocaleString("en-IN")} · {pctTxt(v)}</span></div>); })}
      </div>
      <div className="race-ctl"><button className="btn sm" type="button" onClick={() => { if (!play && i >= last) setI(0); setPlay(p => !p); }}>{play ? "Pause" : "Play"}</button>
        <label className="sr" htmlFor="raceRange">Call</label><input type="range" id="raceRange" min={0} max={last} step={1} value={i} onChange={e => { setPlay(false); setI(+e.target.value); }} /></div>
      <p className="small muted">Values are marked at each call with that moment&apos;s oracle prices.{example ? " When live, this replays the real season from its replay file." : ""}</p>
    </div>
  );
}

/* ================= Talk to a bot ================= */
export function TalkToBot({ botId, name }: { botId: string; name: string }) {
  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; content: string }[]>([]); const [busy, setBusy] = useState(false); const [text, setText] = useState(""); const [note, setNote] = useState<string | null>(null);
  const used = msgs.filter(m => m.role === "user").length, left = Math.max(0, 6 - used);
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); const v = text.trim(); if (!v || busy || left === 0) return;
    const next = [...msgs, { role: "user" as const, content: v }]; setMsgs(next); setText(""); setBusy(true); track("talk_sent");
    try {
      const r = await fetch("/api/site/talk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ botId, messages: next.slice(-8) }) });
      const j = (await r.json().catch(() => ({}))) as { reply?: string; error?: string };
      if (!r.ok || !j.reply) { setNote(r.status === 429 ? "That's 6 messages for now. Try again in a few minutes." : "The bot can't chat right now."); setMsgs(next); }
      else setMsgs([...next, { role: "assistant", content: j.reply }]);
    } catch { setNote("The bot can't chat right now."); } finally { setBusy(false); }
  };
  return (
    <div className="card talk">
      <div className="block-head"><div className="row"><DnaBot size={48} bot={{ id: botId, name }} /><h3>Talk to {name}</h3></div><span className="badge example">AI · IN CHARACTER</span></div>
      <div className="talk-log" aria-live="polite">
        {msgs.length === 0 && <p className="tm assistant">Hi, I&apos;m {name}. Ask me about my last call or what my owner coached me on.</p>}
        {msgs.map((m, k) => <p key={k} className={`tm ${m.role}`}>{m.content}</p>)}{busy && <p className="tm assistant">…</p>}
      </div>
      <form className="row" onSubmit={send}><label className="sr" htmlFor="talkIn">Message {name}</label><input className="inp" id="talkIn" maxLength={200} placeholder="Ask something" style={{ flex: "1 1 220px" }} value={text} onChange={e => setText(e.target.value)} disabled={left === 0} /><button className="btn sm" type="submit" disabled={busy || left === 0}>Send</button></form>
      <p className="small muted">{note ? `${note} ` : ""}Replies are written by AI in the bot&apos;s voice, from its public record. A game character trading play money: not advice. {left} messages left.</p>
    </div>
  );
}

/* ================= Share card PNG ================= */
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function cardSvg({ title, line, stat, seed, hint, example }: { title: string; line: string; stat: string; seed: string; hint: string; example: boolean }) {
  const bot = dnaSvg({ seed, hint, mood: "proud", uid: "card" }).replace("<svg viewBox", '<svg x="70" y="150" width="330" height="340" viewBox');
  const words = line.split(" "), lines: string[] = []; let l = "";
  words.forEach(w => { if ((l + " " + w).trim().length > 38) { lines.push(l.trim()); l = w; } else l += " " + w; }); lines.push(l.trim());
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#0B0D16"/><rect x="40" y="110" width="390" height="420" rx="40" fill="#FFC93C" stroke="#000" stroke-width="6"/><rect x="62" y="132" width="346" height="376" rx="26" fill="#DDF3E4" stroke="#000" stroke-width="5"/>${bot}<text x="460" y="150" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="700" fill="#FFC93C" letter-spacing="3">BOTFOLIO</text><text x="460" y="230" font-family="Arial,Helvetica,sans-serif" font-size="56" font-weight="800" fill="#fff">${esc(title).slice(0, 34)}</text>${lines.slice(0, 3).map((t, i) => `<text x="460" y="${330 + i * 44}" font-family="Arial,Helvetica,sans-serif" font-size="32" fill="#C9CEDA">${esc(t)}</text>`).join("")}<text x="460" y="480" font-family="Courier New,monospace" font-size="28" font-weight="700" fill="#3DDC97">${esc(stat)}</text>${example ? '<rect x="1010" y="112" width="150" height="40" rx="20" fill="none" stroke="#FFC24D" stroke-width="3"/><text x="1085" y="140" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="700" fill="#FFC24D">EXAMPLE</text>' : ""}<line x1="40" y1="560" x2="1160" y2="560" stroke="#262A3D" stroke-width="3"/><text x="40" y="600" font-family="Arial,Helvetica,sans-serif" font-size="22" fill="#B4B9C6">Play money. Not investment advice. No prizes.</text><text x="1160" y="600" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="22" fill="#B4B9C6">Settled against QIE's official mainnet oracle</text></svg>`;
}
const toPng = (svg: string) => new Promise<Blob>((res, rej) => { const img = new Image(); img.onload = () => { const c = document.createElement("canvas"); c.width = 1200; c.height = 630; c.getContext("2d")!.drawImage(img, 0, 0); c.toBlob(b => (b ? res(b) : rej(new Error("png"))), "image/png"); }; img.onerror = rej; img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
export function ShareCardButton(props: Parameters<typeof cardSvg>[0] & { label?: string }) {
  const [url, setUrl] = useState<string | null>(null); const [blob, setBlob] = useState<Blob | null>(null); const [msg, setMsg] = useState("");
  const make = async () => { try { const b = await toPng(cardSvg(props)); setBlob(b); setUrl(URL.createObjectURL(b)); sfx("coin"); track("card_saved"); } catch { setMsg("Couldn't make the image in this browser."); } };
  const name = `botfolio-${props.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.png`;
  return (
    <>
      <button className="btn ghost sm" type="button" onClick={make}>{props.label ?? "Save card"}</button>
      {msg && <span className="small down">{msg}</span>}
      {url && <div className="party" role="dialog" aria-modal="true" aria-label="Your card" onClick={e => e.target === e.currentTarget && setUrl(null)}>
        <div className="dex-modal" style={{ display: "block", position: "relative", maxWidth: 640 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`${props.title} card`} style={{ width: "100%", borderRadius: 14, border: "2px solid var(--ink)" }} />
          <div className="row" style={{ marginTop: 12 }}><a className="btn accent sm" href={url} download={name}>Download PNG</a>
            <button className="btn sm" type="button" onClick={async () => { try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob! })]); setMsg("Image copied"); } catch { setMsg("Copy blocked here: use Download."); } }}>Copy image</button>
            <button className="btn ghost sm" type="button" onClick={() => setUrl(null)} autoFocus>Close</button></div>
        </div></div>}
    </>
  );
}

/* ================= Judges attract mode ================= */
export function Attract({ ids }: { ids: { id: string; name: string }[] }) {
  const [show, setShow] = useState(false);
  useEffect(() => { const id = setTimeout(() => { try { setShow(sessionStorage.getItem("bf-attract") !== "1"); } catch { setShow(true); } }, 0); return () => clearTimeout(id); }, []);
  const hide = () => { setShow(false); try { sessionStorage.setItem("bf-attract", "1"); } catch { /* storage blocked */ } };
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && hide(); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, []);
  if (!show) return null;
  return (
    <div className="attract"><div className="attract-in">
      <p className="pixel attract-title">BOTFOLIO</p><p className="attract-sub">Raise an AI trader in one sentence. Coach it. Let QIE keep score.</p>
      <div className="march" aria-hidden="true">{[...ids, ...ids].map((b, i) => <DnaBot key={i} size={64} bot={b} />)}</div>
      <button className="press" type="button" autoFocus onClick={() => { sfx("start"); track("tour_start"); hide(); setTimeout(() => (document.querySelector<HTMLButtonElement>("[data-tour-play]"))?.click(), 200); }}>PRESS START</button>
      <p className="small" style={{ color: "#8C93B8" }}>90-second tour · or <button type="button" className="linkish" onClick={hide}>skip to the page</button></p>
    </div></div>
  );
}

/* ================= Verify any tx ================= */
interface VerifyAnswer { ok: boolean; found?: boolean; block?: string; to?: string | null; contract?: string | null; status?: string; logs?: number; error?: string; trades?: VerifiedTrade[] }
export function VerifyTx({ explorer }: { explorer: string }) {
  const [v, setV] = useState(""); const [a, setA] = useState<VerifyAnswer | null>(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); const h = v.trim().toLowerCase(); setA(null);
    if (!/^0x[0-9a-f]{64}$/.test(h)) { setMsg("That isn't a tx hash. It should be 0x followed by 64 hex characters."); return; }
    setMsg(""); setBusy(true); track("verify_tx");
    try { const r = await fetch(`/api/site/verify?tx=${h}`, { cache: "no-store" }); setA((await r.json()) as VerifyAnswer); } catch { setA({ ok: false, error: "unreachable" }); } finally { setBusy(false); }
  };
  const steps = a?.ok && a.found ? [
    ["TX", "Transaction found", `Status ${a.status ?? "?"} · ${a.logs ?? 0} event logs`],
    ["BLOCK", "Included on QIE mainnet", `Block ${a.block}`],
    ["TO", a.contract ? `Sent to BotFolio's ${a.contract}` : "Not a BotFolio contract", a.to ?? "contract creation"],
    // Decoded PaperLedger Trade logs: the oracle round and price the contract read itself in this tx.
    ...(a.trades ?? []).map((t, k) => [`TRADE${(a.trades?.length ?? 0) > 1 ? ` ${k + 1}` : ""}`,
      `Bot #${t.botId} ${t.side === "BUY" ? "bought" : "sold"} ${t.asset ?? "an asset"}${t.ownerApproved ? " · signed by its owner" : ""}`,
      `${usd(e8ToNumber(t.priceE8), t.asset ? priceDecimals(t.asset) : 2)} · oracle round ${t.roundId} · price time ${new Date(t.oracleUpdatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })} IST`]),
  ] : [];
  return (
    <div className="stack">
      <form className="row" onSubmit={go} noValidate><label className="sr" htmlFor="verifyIn">Transaction hash</label><input className="inp mono" id="verifyIn" placeholder="0x…" value={v} onChange={e => setV(e.target.value)} style={{ flex: "1 1 260px" }} autoComplete="off" /><button className="btn accent" type="submit" disabled={busy}>{busy ? "Reading QIE…" : "Trace it"}</button></form>
      <p className="small" aria-live="polite">{msg}{a && !a.ok && "QIE mainnet didn't answer. Try again, or open the explorer directly."}{a?.ok && !a.found && "No transaction with that hash on QIE mainnet."}</p>
      {steps.length > 0 && <ol className="custody">{steps.map(([n, k, d]) => <li key={n} className="lit done"><span className="node">{n}</span><div><div className="k">{k}</div><div className="v mono">{d}</div></div></li>)}</ol>}
      {a?.ok && a.found && <a className="small" href={`${explorer}/tx/${v.trim()}`} target="_blank" rel="noopener">Open it on the explorer</a>}
    </div>
  );
}

/* ================= Bot page: evolution + trust gauge ================= */
export function Evolution({ botId, name, versions }: { botId: string; name: string; versions: { version: number; max_per_coin_bps: number }[] }) {
  const vs = [...versions].sort((a, b) => a.version - b.version);
  if (!vs.length) return null;
  return (
    <div className="card"><div className="block-head"><h3>How it evolved</h3><span className="small muted">same DNA, new version</span></div>
      <div className="evo">{vs.map((v, k) => <span key={v.version} style={{ display: "contents" }}>{k > 0 && <span className="evo-arrow" aria-hidden="true">→</span>}<figure><DnaBot size={84} bot={{ id: botId, name }} version={v.version} mood={k === vs.length - 1 ? "proud" : "smile"} /><figcaption><b>v{v.version}</b><br /><span className="small muted">max {v.max_per_coin_bps / 100}% per coin</span></figcaption></figure></span>)}
        <span className="evo-arrow" aria-hidden="true">→</span><figure className="evo-next"><DnaBot size={84} bot={{ id: botId, name }} version={vs[vs.length - 1].version + 1} mood="think" /><figcaption><b>v{vs[vs.length - 1].version + 1}?</b><br /><span className="small muted">after you coach it</span></figcaption></figure></div></div>
  );
}
export function TrustGauge({ f, total }: { f: [number, number, number, number]; total: number }) {
  const C = 2 * Math.PI * 52, cols = ["var(--accent)", "#FFC93C", "#3DD6A3", "#FF6FA8"];
  return (
    <div className="gauge"><svg viewBox="0 0 140 140" role="img" aria-label={`Trust score ${total} of 1000`}><circle cx="70" cy="70" r="52" fill="none" stroke="var(--surface-2)" strokeWidth="14" />
      {f.map((v, i) => { const len = (v / 1000) * C; return <circle key={i} cx="70" cy="70" r="52" fill="none" stroke={cols[i]} strokeWidth="14" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-(i * 250 / 1000) * C} transform="rotate(-90 70 70)" />; })}
      <text x="70" y="76" textAnchor="middle" fontFamily="Archivo,Arial" fontWeight="800" fontSize="26" fill="currentColor">{total}</text></svg>
      <ul className="gauge-key">{["Rules", "Drawdown", "Consistency", "Explains"].map((k, i) => <li key={k}><i style={{ background: cols[i] }} />{k} {f[i]}/250</li>)}</ul></div>
  );
}
