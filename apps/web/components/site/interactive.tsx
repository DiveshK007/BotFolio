"use client";
import { reducedMotion } from "./fx";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DnaBot as BotHead } from "./DnaBot";
import { Badge, Icon, TxChip } from "./ui";
import { CopyButton } from "./chrome";
import { CustodyTrace, Flap, type CustodyNode } from "./arcade";
import { ASSETS, explorerAddress } from "@botfolio/shared";
import { arrow, money, pct, short, upDown } from "@/lib/site/format";
import type { BoardId, BoardRow, CardPayload, DataStatus, Leaderboards } from "@/lib/site/types";

/* ---------- Verify-on-QIE flip card ---------- */
export function FlipCard({ card, status }: { card: CardPayload; status: DataStatus }) {
  const [flipped, setFlipped] = useState(false);
  const [run, setRun] = useState(0);
  const gold = ASSETS.find(a => a.id === "GOLD")!;
  const nodes: CustodyNode[] = card.kind === "challenge" ? [
    { tag: "CARD", title: "The challenge your friend sent", body: "A link with two bots on it. Here is what makes the matchup real." },
    { tag: "TX", title: "Challenge created", body: <><TxChip hash={card.proofs[0].txHash} /> Challenges.create, signed by the challenger</> },
    { tag: "BLOCK", title: "Included on QIE mainnet", body: "Chain 1990 · ~3.6 s blocks" },
    { tag: "SEASON", title: "Season and versions locked", body: "Both bots race the next season on the versions they had when it was accepted" },
    { tag: "RESULT", title: "Settled at season close", body: "Higher season return wins, from oracle marks anyone can recompute. No stakes." },
  ] : card.kind === "evolution" ? [
    { tag: "CARD", title: "The card your friend sent", body: "An image anyone can screenshot. So we don't ask you to trust it." },
    { tag: "TX", title: "Version commit", body: <><TxChip hash={card.proofs[0].txHash} /> SeasonLedger.commitVersion, signed by the owner</> },
    { tag: "BLOCK", title: "Included on QIE mainnet", body: "Chain 1990 · ~3.6 s blocks" },
    { tag: "HASH", title: "Config hash for the new version", body: "The exact rules the bot runs now" },
    { tag: "WHY", title: "The coaching behind it", body: <>{card.proofs[1] && <TxChip hash={card.proofs[1].txHash} />} signed corrections</> },
  ] : [
    { tag: "CARD", title: "The card your friend sent", body: "An image anyone can screenshot. So we don't ask you to trust it." },
    { tag: "TX", title: "The trade transaction", body: <><TxChip hash={card.proofs[0].txHash} /> PaperLedger records the trade and the price it used</> },
    { tag: "BLOCK", title: "Included on QIE mainnet", body: "Chain 1990 · ~3.6 s blocks" },
    { tag: "ROUND", title: "The oracle round", body: card.proofs[0].whatItProves },
    { tag: "FEED", title: "QIE's price feed", body: <><a className="tx" href={explorerAddress(gold.feed)} target="_blank" rel="noopener">{short(gold.feed)}</a> real feed, 8 decimals, QIE-operated</> },
  ];
  const back = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (flipped) setTimeout(() => back.current?.focus({ preventScroll: true }), 300); }, [flipped]);
  const kindLabel = card.kind.toUpperCase().replace("TRADE", "FIRST TRADE");
  return (
    <>
      <div className="row">
        <button className="btn accent" type="button" aria-controls="flip" aria-expanded={flipped} onClick={() => { if (!flipped) setRun(r => r + 1); setFlipped(f => !f); }}><Icon name="eye" size={18} />Verify on QIE</button>
        <CopyButton text={typeof window === "undefined" ? "" : location.href} label="Copy link" className="btn ghost" />
      </div>
      <div className="flip" id="flip" data-flipped={flipped}>
        <div className="flip-inner">
          <div className="face-f" aria-hidden={flipped} inert={flipped}>
            <div className="share-card holo">
              <div className="top"><div className="who"><BotHead size={52} bot={card.bot} mood={card.kind === "roast" ? "sad" : "smile"} /><div><b style={{ font: "800 20px var(--f-display)", color: "#fff" }}>{card.bot.name}</b><div className="score">Season {card.season} · trust {card.trust}</div></div></div><span className="kind">{kindLabel}</span></div>
              {card.kind === "challenge" && card.opponent && <div className="faceoff" aria-hidden="true"><BotHead size={96} bot={card.bot} mood="proud" /><span className="vs">VS</span><BotHead size={96} bot={card.opponent} version={2} /></div>}{card.kind === "evolution" && <div className="row" style={{ gap: 6 }} aria-hidden="true"><BotHead size={64} bot={card.bot} version={1} /><span style={{ font: "800 26px var(--f-display)", color: "#FFC93C" }}>→</span><BotHead size={64} bot={card.bot} version={2} mood="proud" /></div>}<p className="big">{card.headline}</p><p style={{ color: "#C9CEDA" }}>{card.line}</p>
              <div className="foot"><span>Settled against QIE&apos;s official mainnet oracle · play money · not advice</span><span>tx {short(card.proofs[0]?.txHash ?? "0x")}</span></div>
            </div>
          </div>
          <div className="face-b" aria-hidden={!flipped} inert={!flipped}>
            <div className="block-head"><h3 ref={back} tabIndex={-1}>Verify on QIE</h3>{status === "example" ? <Badge kind="example">EXAMPLE TXS</Badge> : <Badge kind="live">ON QIE</Badge>}</div>
            <p className="small muted">Follow the card all the way down to QIE&apos;s own price feed.</p>
            <CustodyTrace nodes={nodes} run={run} />
            <button className="btn sm" type="button" style={{ marginTop: 14, marginRight: 8 }} onClick={() => setRun(r => r + 1)}>Trace it again</button>
            <button className="btn ghost sm" type="button" style={{ marginTop: 14 }} onClick={() => setFlipped(false)}>Back to the card</button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- Agent asks the MCP (EXAMPLE replay) ---------- */
type Msg = { k: "u" | "t" | "a"; body: React.ReactNode };
const SCRIPT: Msg[] = [
  { k: "u", body: "Is AlphaWolf actually good?" },
  { k: "t", body: <><b>→ get_bot_record</b>(bot_id: 7)</> },
  { k: "t", body: "← season 1: return −12.40% · battle rank 4/4 · trust 312 · 14 trades" },
  { k: "t", body: <><b>→ verify_trade</b>(tx_hash: &quot;0xe0a1…0031&quot;)</> },
  { k: "t", body: "← { valid: true, price: 3730.84, roundId: 14811, matchesOracle: true }" },
  { k: "a", body: "Honestly? Not good. It lost 12.4% last season and finished last against the house bots, with a trust score of 312/1000. The record is real, though: I re-read one of its Gold trades from QIE, and the price matches oracle round 14811." },
];
export function AgentDemo() {
  const [n, setN] = useState(0); const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const play = () => {
    timers.current.forEach(clearTimeout); setN(0);
    const gap = reducedMotion() ? 0 : 900;
    timers.current = SCRIPT.map((_, i) => setTimeout(() => setN(i + 1), (i + 1) * gap));
  };
  return (
    <div className="grid g2" style={{ alignItems: "start" }}>
      <div className="stack">
        <h2>Ask an agent: &quot;Is AlphaWolf actually good?&quot;</h2>
        <p className="muted">The agent calls <span className="mono">get_bot_record</span>, then <span className="mono">verify_trade</span> to re-read a trade and its oracle round from QIE, and answers from chain data.</p>
        <div className="row"><button className="btn accent" type="button" onClick={play}><Icon name="play" size={16} />Play the conversation</button><Badge kind="example">EXAMPLE replay</Badge></div>
      </div>
      <div className="card"><div className="chat" aria-live="polite">
        {n === 0 && <p className="muted small">Press play to watch an example conversation.</p>}
        {SCRIPT.slice(0, n).map((m, i) => <div key={i} className={`m ${m.k}`}>{m.body}</div>)}
        {n === SCRIPT.length && <p className="small muted"><Badge kind="example">EXAMPLE</Badge> Scripted to match the real tool shapes. Runs against live chain data once the MCP server is up.</p>}
      </div></div>
    </div>
  );
}

/* ---------- Judges tour bar ---------- */
const TOUR = ["What it is", "Mainnet proof", "QIE pieces", "Traction", "Why chain", "Remember"];
const STEP_MS = 15000;
export function JudgesTour() {
  const [i, setI] = useState(0); const [playing, setPlaying] = useState(false); const [prog, setProg] = useState(1 / 6);
  const start = useRef(0);
  const goTo = (k: number) => {
    setI(k); setProg((k + 1) / 6);
    const smooth = !reducedMotion();
    document.getElementById(`t${k + 1}`)?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  };
  useEffect(() => {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && !playing) { const k = +e.target.id.slice(1) - 1; setI(k); setProg((k + 1) / 6); } }), { rootMargin: "-45% 0px -45% 0px" });
    document.querySelectorAll(".tour-sec").forEach(s => io.observe(s));
    return () => io.disconnect();
  }, [playing]);
  useEffect(() => {
    if (!playing) return;
    start.current = Date.now() - i * STEP_MS;
    const t = setInterval(() => {
      const el = Date.now() - start.current; setProg(Math.min(1, el / (STEP_MS * 6)));
      const k = Math.floor(el / STEP_MS);
      if (k >= 6) { setPlaying(false); setI(0); return; }
      setI(prev => { if (prev !== k) goTo(k); return k; });
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);
  return (
    <div className="tourbar"><div className="wrap">
      <button className="btn accent sm" type="button" data-tour-play onClick={() => { if (!playing) goTo(i); setPlaying(p => !p); }}>{playing ? "Pause tour" : "Play the 90-second tour"}</button>
      <div className="tour-steps" role="group" aria-label="Tour steps">{TOUR.map((t, k) => <button key={t} type="button" aria-current={k === i ? "step" : undefined} onClick={() => { setPlaying(false); goTo(k); }}>{k + 1}. {t}</button>)}</div>
      <div className="tour-prog" aria-hidden="true"><i style={{ width: `${prog * 100}%` }} /></div>
    </div></div>
  );
}

/* ---------- Leaderboard tabs ---------- */
const TABS: { id: BoardId; label: string }[] = [{ id: "returns", label: "Top Returns" }, { id: "risk", label: "Best Risk-Adjusted" }, { id: "trusted", label: "Most Trusted" }, { id: "coach", label: "Coach vs Bot" }];
function Rows({ rows, value, head, extra }: { rows: BoardRow[]; value: (r: BoardRow) => { t: React.ReactNode; c?: string }; head: string; extra?: boolean }) {
  return (
    <div className="scroll lb" tabIndex={0} aria-label="Leaderboard table"><table>
      <thead><tr><th>#</th><th>Bot</th><th className="num">{head}</th>{extra && <th className="num opt">Play value</th>}<th className="num opt">Trades</th><th className="num">Trust</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={r.bot.id}><td><span className="rank">{i + 1}</span></td>
          <td><div className="botcell"><BotHead size={40} bot={r.bot} /><div><b><Link href={`/bot/${r.bot.id}`}>{r.bot.name}</Link> <span aria-hidden="true">{r.bot.emoji}</span>{r.bot.isHouse && <> <Badge kind="house">HOUSE</Badge></>}{r.trust === null && <> <Badge kind="new">NEW</Badge></>}</b><span className="o">{r.bot.isHouse ? r.bot.houseRule : r.bot.qieName ?? short(r.bot.ownerWallet)}</span></div></div></td>
          <td className={`num ${value(r).c ?? ""}`}><b>{value(r).t}</b></td>{extra && <td className="num opt">{money(r.valueDisplay)}</td>}<td className="num opt">{r.trades}</td><td className="num">{r.trust ?? <span className="muted">new</span>}</td></tr>
      ))}</tbody></table></div>
  );
}
function Leader({ r, season, value }: { r: BoardRow; season: number; value: React.ReactNode }) {
  return <div className="leader holo"><BotHead size={64} bot={r.bot} /><div><p className="small muted">Top human-raised bot · Season {season}</p><p style={{ font: "800 26px/1.1 var(--f-display)" }}>{r.bot.name}</p><p className="small muted">{r.bot.qieName ?? short(r.bot.ownerWallet)}</p></div><div className="lv" style={{ font: "800 30px var(--f-display)" }}>{value}</div></div>;
}
export function LeaderboardTabs({ boards }: { boards: Leaderboards }) {
  const [tab, setTab] = useState<BoardId>("returns");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, k: number) => {
    const n = e.key === "ArrowRight" ? (k + 1) % 4 : e.key === "ArrowLeft" ? (k + 3) % 4 : e.key === "Home" ? 0 : e.key === "End" ? 3 : -1;
    if (n < 0) return; e.preventDefault(); setTab(TABS[n].id); refs.current[n]?.focus();
  };
  const humanTop = (rows: BoardRow[]) => rows.find(r => !r.bot.isHouse);
  let panel: React.ReactNode;
  if (tab === "returns") {
    const top = humanTop([...boards.returns].sort((a, b) => b.returnPct - a.returnPct));
    panel = <>{top && <Leader r={top} season={boards.season} value={<Flap text={pct(top.returnPct)} />} />}<Rows rows={boards.returns} head="Season return" extra value={r => ({ t: `${arrow(r.returnPct)} ${pct(r.returnPct)}`, c: upDown(r.returnPct) })} />
      <p className="small muted" style={{ marginTop: 10 }}>Return = value at close ÷ value at open − 1. Ties go to the smaller drawdown. House bots run fixed rules and never take the top spot.</p></>;
  } else if (tab === "risk") {
    panel = boards.risk.length ? <Rows rows={boards.risk} head="Sortino" value={r => ({ t: (r.sortino ?? 0).toFixed(2) })} /> :
      <div className="card stack"><h3>Nobody qualifies yet, by design</h3><p className="muted">This board needs at least 3 daily returns in a season. Sprint seasons (S1–S4) last 2 days, so they only have 2. The first season that can fill it is S5 (Dec 4–6).</p></div>;
  } else if (tab === "trusted") {
    const top = humanTop(boards.trusted);
    panel = boards.trusted.length ? <>{top && <Leader r={top} season={boards.season} value={<Flap text={String(top.trust)} />} />}<Rows rows={boards.trusted} head="Trust score" value={r => ({ t: r.trust ?? "new" })} /></> :
      <div className="card stack"><h3>No trusted bots yet</h3><p className="muted">Bots appear here after 8 trades and one finished season.</p></div>;
  } else {
    panel = <div className="scroll" tabIndex={0} aria-label="Coach vs Bot table"><table><thead><tr><th>#</th><th>Coach</th><th>Their bot</th><th className="num">You – Bot</th><th className="num">Win rate</th></tr></thead><tbody>
      {boards.coach.map((c, i) => <tr key={c.owner}><td><span className="rank">{i + 1}</span></td><td className="mono small">{short(c.owner)}</td><td><div className="botcell"><BotHead size={40} bot={c.bot} /><b>{c.bot.name}</b></div></td><td className="num"><b>{c.you} – {c.botScore}</b></td><td className="num">{Math.round((c.you / Math.max(1, c.you + c.botScore)) * 100)}%</td></tr>)}
    </tbody></table></div>;
  }
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Boards">
        {TABS.map((t, k) => <button key={t.id} ref={el => { refs.current[k] = el; }} role="tab" id={`tab-${t.id}`} aria-controls="lbPanel" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)} onKeyDown={e => onKey(e, k)}>{t.label}</button>)}
      </div>
      <div id="lbPanel" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0}>{panel}</div>
    </>
  );
}
