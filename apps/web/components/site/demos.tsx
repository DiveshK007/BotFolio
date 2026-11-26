"use client";
/** Home-page signature widgets: PetDevice, HowItWorks, CoachDemo. All EXAMPLE, all keyboard/touch friendly. */
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AssetId } from "@botfolio/shared";
import type { DnaMood } from "@/lib/dna";
import { DnaBot as BotHead } from "./DnaBot";
import { reducedMotion } from "./fx";
import { Badge, Icon, type IconName, PriceAge, TxChip } from "./ui";
import { assetLabel, money, MAX_AGE_MIN, priceDecimals, short, usd } from "@/lib/site/format";

const subscribeRM = (cb: () => void) => { const m = matchMedia("(prefers-reduced-motion: reduce)"); m.addEventListener("change", cb); const o = new MutationObserver(cb); o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] }); return () => { m.removeEventListener("change", cb); o.disconnect(); }; };
const useReducedMotion = () => useSyncExternalStore(subscribeRM, () => reducedMotion(), () => false);
export type PriceMap = Record<AssetId, { price: number; roundId: string; ageMin: number }>;
const exHash = (n: number) => `0x${"e0a1".padEnd(60, "0")}${String(n).padStart(4, "0")}`;

/* ---------- PetDevice: the hero. Type a sentence (A), the bot assembles from its DNA, launch it (B) into the arena. ---------- */
type Persona = { name: string; asset: AssetId; max: number; trades: number; line: string; rules: (m: number) => string[]; voice: string[] };
const PERSONAS: (Persona & { test: RegExp })[] = [
  { test: /gold|careful|safe|dad|mom|amma|appa|slow|patient/i, name: "Gold Guru", asset: "GOLD", max: 25, trades: 2, line: "Patient, cautious and deeply suspicious of anything that moves fast.", rules: m => ["Keeps a big cushion of cash", "Likes Gold; small Bitcoin only after a calm day", `Never more than ${m}% in one coin`], voice: ["Slow and steady. Like Dad said.", "Gold first, questions later.", "I checked the oracle twice. Still gold."] },
  { test: /yolo|maxi|moon|never sell|bitcoin|btc|diamond/i, name: "Moon Mule", asset: "BTC", max: 50, trades: 6, line: "Stubborn, loud and allergic to the sell button.", rules: m => ["Buys Bitcoin on every dip", "Almost never sells", `Max ${m}% in one coin (the app caps it at 50)`], voice: ["Sell? Never heard of her.", "Bitcoin dipped. I bought. Obviously.", "My limit is 50%. I respect it. Barely."] },
  { test: /dip|sol|xrp|quick|fast/i, name: "Dip Doctor", asset: "SOL", max: 30, trades: 5, line: "Waits for a dip, buys it, and leaves early.", rules: m => ["Buys SOL or XRP after a drop", "Sells after a quick rise", `Never more than ${m}% in one coin`], voice: ["The doctor is in. The dip is not.", "In, out, done. Next patient.", "Red candle? Lovely. Prescribing SOL."] },
  { test: /eth|ether/i, name: "Ether Pilot", asset: "ETH", max: 35, trades: 3, line: "Calm, curious and fond of Ethereum.", rules: m => ["Mostly Ethereum, some cash", "Trims after big up days", `Never more than ${m}% in one coin`], voice: ["Cruising altitude: Ethereum.", "Trimmed a little. Feels responsible.", "Smooth skies. For now."] },
];
function makePersona(text: string): Persona {
  const p = PERSONAS.find(x => x.test.test(text)); if (p) return p;
  const w = (text.match(/[A-Za-z]{3,}/g) ?? ["Rookie"])[0];
  return { name: (w[0].toUpperCase() + w.slice(1).toLowerCase()).slice(0, 14) + " Bot", asset: "BTC", max: 30, trades: 3, line: `"${text.slice(0, 60)}", as a trading style.`, rules: m => ["Spreads bets across a few coins", "Holds cash when unsure", `Never more than ${m}% in one coin`], voice: ["New here. Learning fast.", "I read your sentence. I have a plan. Sort of.", "Coach me. I take notes."] };
}
const EXAMPLES: [string, string][] = [["Careful like my dad, loves gold", "Careful like my dad, loves gold"], ["YOLO Bitcoin maxi, never sells", "YOLO Bitcoin maxi, never sells"], ["Buys dips on SOL and XRP, sells fast on the way up", "Buys dips on SOL and XRP"]];
const PET_LINES = ["Hi. I watch prices so you don't have to. Poke me.", "I trade play money. Your real money stays exactly where it is.", "Four calls a day. I have opinions at every one of them.", "Tell me when I mess up. I take notes. On-chain ones.", "Not advice. Just vibes and oracle prices."];
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

export function PetDevice({ prices, appUrl }: { prices: PriceMap; appUrl?: string | null }) {
  const rm = useReducedMotion();
  const [text, setText] = useState(""); const [p, setP] = useState<Persona | null>(null); const [seed, setSeed] = useState("botfolio");
  const [mood, setMood] = useState<DnaMood>("smile"); const [bubble, setBubble] = useState(PET_LINES[0]); const [line, setLine] = useState(0);
  const [assemble, setAssemble] = useState(false); const [sleeping, setSleeping] = useState(false); const [meter, setMeter] = useState(3);
  const [max, setMax] = useState(30); const [trades, setTrades] = useState(3); const [lcd, setLcd] = useState<React.ReactNode>(<span>Type one sentence below and press <b>A</b>.</span>);
  const [wobble, setWobble] = useState(0); const launched = useRef(false); const shake = useRef({ dir: 0, x: 0, flips: [] as number[] });
  const typeOut = (t: string) => { if (rm) { setBubble(t); return; } let i = 0; const id = setInterval(() => { setBubble(t.slice(0, ++i)); if (i >= t.length) clearInterval(id); }, 22); };
  // sleep after 30 s idle, wake on any input
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const arm = () => { clearTimeout(t); t = setTimeout(() => { setSleeping(true); setMood("sleep"); setBubble("Zzz… wake me at the next call."); }, 30000); };
    const wake = () => { setSleeping(s => { if (s) { setMood("o"); setBubble("Huh? I was resting my eyes. Watching the oracle. With my eyes closed."); setTimeout(() => setMood("smile"), 600); } return false; }); arm(); };
    arm(); ["pointerdown", "keydown", "scroll"].forEach(ev => addEventListener(ev, wake, { passive: true }));
    return () => { clearTimeout(t); ["pointerdown", "keydown", "scroll"].forEach(ev => removeEventListener(ev, wake)); };
  }, []);
  const onShake = (e: React.PointerEvent) => {
    if (rm) return; const s = shake.current; const dx = e.clientX - s.x; s.x = e.clientX; if (Math.abs(dx) < 14) return;
    const d = Math.sign(dx), now = Date.now(); if (d !== s.dir) { s.dir = d; s.flips = s.flips.filter(t => now - t < 900); s.flips.push(now); }
    if (s.flips.length >= 7) { s.flips = []; setMood("dizzy"); setBubble("Whoa. Stop. I'm a trader, not a cocktail."); setWobble(w => w + 1); setTimeout(() => setMood("smile"), 1800); }
  };
  const poke = () => { const lines = p ? [p.line, ...p.voice] : PET_LINES; const n = (line + 1) % lines.length; setLine(n); setBubble(lines[n]); setMood("o"); setWobble(w => w + 1); setTimeout(() => setMood(m => (m === "o" ? "smile" : m)), 380); };
  const make = (e?: FormEvent, value?: string) => {
    e?.preventDefault(); const t = (value ?? text).trim() || EXAMPLES[0][0]; setText(t);
    const np = makePersona(t); setP(np); setSeed(`pet-${hash(t.toLowerCase())}`); setMax(np.max); setTrades(np.trades); setMeter(3); setMood("smile"); setLine(0); launched.current = false;
    setAssemble(!rm); setBubble(""); setTimeout(() => { setAssemble(false); typeOut(np.line); }, rm ? 0 : 1400);
    setLcd(<><span><b>{np.name}</b> · max {np.max}% per coin · {np.trades} trades/day</span><span className="small">Press <b>B</b> to launch</span></>);
  };
  const launch = () => {
    if (!p) return; const a = p.asset, pr = prices[a];
    if (pr.ageMin > MAX_AGE_MIN[a]) { setLcd(<><span>{assetLabel(a)} market quiet — holding until a fresh price.</span><PriceAge asset={a} ageMin={pr.ageMin} /></>); setMood("think"); setBubble("No fresh price, no trade. Rules are rules."); }
    else { setLcd(<><span>Bought <b>{money(100000 * Math.min(max, 25) / 100)}</b> of {assetLabel(a)} at {usd(pr.price, priceDecimals(a))} · round {pr.roundId}</span><span className="row" style={{ gap: 8 }}><PriceAge asset={a} ageMin={pr.ageMin} /><TxChip hash={exHash(1)} label="tx" /></span></>); setMood("proud"); setMeter(5); typeOut("First trade done. Joining the arena. Wish me luck."); }
    if (!launched.current) { launched.current = true; dispatchEvent(new CustomEvent("bf:launch", { detail: { id: seed, name: p.name, personaText: text, ret: 0, vol: Math.min(1, max / 50), you: true, lines: [p.voice[1], "Okay that one hurt. Coach me."] } })); }
  };
  return (
    <form className="device" id="try" onSubmit={make} onPointerMove={onShake} autoComplete="off" noValidate aria-label="Make a bot">
      <div className="device-top"><span>BOTFOLIO · PET-01</span><span className="lights" aria-hidden="true"><i className="on" /><i /><i /></span></div>
      <div className="screen">
        <div className="screen-bar"><span>{p ? p.name.toUpperCase() : "BOTFOLIO"}</span><span className="row" style={{ gap: 10 }}><Badge kind="example" title="This preview runs in your browser. It is not the real AI.">EXAMPLE</Badge><span>MOOD <span className="meter" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <i key={i} className={i < meter ? "on" : ""} />)}</span></span></span></div>
        <div className="pet-stage">
          <p className="pet-bubble" aria-live="polite">{bubble}</p>
          <button className={`pet bob ${wobble ? "wobble" : ""}`} key={wobble} type="button" aria-label="Poke the bot" onClick={poke}>
            <BotHead size={190} seed={seed} hint={p ? `${p.name} ${text}` : "botfolio mascot"} mood={mood} assemble={assemble} className="pet-head" />
          </button>
          <div className="pet-shadow" aria-hidden="true" />
          {sleeping && <span className="zzz" aria-hidden="true">z z</span>}
        </div>
        <div className="lcd" aria-live="polite">{lcd}</div>
      </div>
      <div className="device-controls">
        <label className="sr" htmlFor="tryInput">Describe your bot in one sentence</label>
        <input className="inp" id="tryInput" maxLength={120} placeholder="Describe your bot in one sentence" value={text} onChange={e => setText(e.target.value)} aria-describedby="tryHelp" />
        <div className="examples" role="group" aria-label="Tap an example">{EXAMPLES.map(([v, l]) => <button key={v} type="button" className="chip" onClick={() => make(undefined, v)}>{l}</button>)}</div>
        <div className="btns">
          <button className="abtn a" type="submit"><span aria-hidden="true">A</span>MAKE BOT</button>
          <button className="abtn b" type="button" onClick={launch} disabled={!p}><span aria-hidden="true">B</span>LAUNCH</button>
        </div>
        {p && <details className="tweaks"><summary>Tweak its limits</summary>
          <div className="slider"><div className="slider-top"><label htmlFor="sMax">Max per coin</label><output htmlFor="sMax">{max}%</output></div><input type="range" id="sMax" min={10} max={50} step={5} value={max} onChange={e => setMax(+e.target.value)} /></div>
          <div className="slider"><div className="slider-top"><label htmlFor="sTrades">Max trades per day</label><output htmlFor="sTrades">{trades}</output></div><input type="range" id="sTrades" min={1} max={8} step={1} value={trades} onChange={e => setTrades(+e.target.value)} /></div>
          <ul className="rules">{p.rules(max).map(r => <li key={r}>{r}</li>)}</ul></details>}
        {appUrl && p && <a className="btn accent sm" href={`${appUrl}/create?s=${encodeURIComponent(text)}`}>Make it for real</a>}
        <p className="small" id="tryHelp" style={{ opacity: 0.8 }}>Preview: a small script in your browser guesses the persona. In the app, the AI writes it and the bot is born on QIE mainnet.</p>
      </div>
    </form>
  );
}

/* ---------- HowItWorks ---------- */
const HOW: { t: string; ico: IconName; d: string; vis: React.ReactNode }[] = [
  { t: "One sentence", ico: "pen", d: "You type one line. The AI turns it into a bot with a name, a personality, rules in plain words and two limits you can drag.", vis: <><p className="small muted">You type</p><p style={{ font: "600 18px var(--f-display)" }}>&quot;Careful like my dad, loves gold&quot;</p><p className="small muted" style={{ marginTop: 10 }}>Max per coin 10–50% · Max trades per day 1–8</p></> },
  { t: "A bot is born", ico: "bot", d: "One passkey tap. A wallet is created quietly and the bot is registered on QIE. No seed phrase, no network prompt, and you never pay gas.", vis: <><p className="small muted">On QIE mainnet</p><p className="mono">BotRegistry.createBot(…)</p><p className="small muted" style={{ marginTop: 8 }}>signed by you · sent by our relayer · gas on us</p></> },
  { t: "Oracle-priced trade", ico: "oracle", d: "Four times a day the bot decides. The contract reads QIE's oracle itself, so the price on the record is the oracle's, not ours.", vis: <><p className="small muted">Inside the contract</p><p className="mono">latestRoundData() → BTC/USDT</p><p className="mono small" style={{ marginTop: 6 }}>round 50887 · 8 decimals <Badge kind="example">EXAMPLE</Badge></p></> },
  { t: "You coach it", ico: "coach", d: "Tap \"bad call\" and pick a reason: too risky, too timid, wrong coin, sold too early. Each correction is a small tx you sign.", vis: <div className="row"><span className="chip" aria-hidden="true">too risky</span><span className="chip" aria-hidden="true">too timid</span><span className="chip" aria-hidden="true">wrong coin</span></div> },
  { t: "New version on-chain", ico: "chain", d: "At season close the bot proposes v2, with every change tied to your feedback. You approve, and its config hash is committed on QIE.", vis: <><p style={{ font: "800 20px/1.2 var(--f-display)" }}>&quot;too risky&quot; 3× → max per coin 40% → 25%</p><p className="mono small muted" style={{ marginTop: 8 }}>SeasonLedger.commitVersion</p></> },
  { t: "Anyone verifies", ico: "eye", d: "Every card links to the tx and the oracle round behind it. The public API and MCP server let other apps and agents check the record too.", vis: <><p className="small muted">Verify on QIE</p><p className="mono small">tx · oracle round · config hash</p><p className="small" style={{ marginTop: 8 }}>&quot;This trade was priced by QIE&apos;s oracle round 50887, not by us.&quot;</p></> },
];
export function HowItWorks() {
  const rm = useReducedMotion(); const [i, setI] = useState(0); const [playing, setPlaying] = useState(true);
  useEffect(() => { if (!playing || rm) return; const t = setInterval(() => setI(x => (x + 1) % HOW.length), 3800); return () => clearInterval(t); }, [playing, rm]);
  const on = playing && !rm;
  return (
    <>
      <div className="section-head"><div><h2 id="howH">From one sentence to a record anyone can check</h2><p className="lede">Six steps. Tap any of them, or let it play.</p></div><button className="btn ghost sm" type="button" aria-pressed={on} onClick={() => setPlaying(!on)}>{on ? "Pause" : "Play"}</button></div>
      <ol className="how">{HOW.map((s, k) => <li key={s.t}><button type="button" aria-current={k === i ? "step" : undefined} onClick={() => { setPlaying(false); setI(k); }}><span className="n">{k + 1}</span><Icon name={s.ico} className="ico" /><span className="t">{s.t}</span></button></li>)}</ol>
      <div className="how-track" aria-hidden="true"><i style={{ width: `${((i + 1) / HOW.length) * 100}%` }} /></div>
      <div className="how-detail">
        <div className="card" aria-live="polite"><p className="small muted">Step {i + 1} of {HOW.length}</p><h3 style={{ marginTop: 6 }}>{HOW[i].t}</h3><p style={{ marginTop: 8 }}>{HOW[i].d}</p></div>
        <div className="card flat" aria-hidden="true" style={{ background: "var(--paper)" }}><div className="panel" key={i}>{HOW[i].vis}</div></div>
      </div>
    </>
  );
}

/* ---------- CoachDemo ---------- */
const CHIP_DIFF: Record<string, { what: string; from: string; to: string }> = {
  "too risky": { what: "Max per coin", from: "40%", to: "25%" },
  "too timid": { what: "Max per coin", from: "40%", to: "45%" },
  "wrong coin": { what: "Rules", from: "Chases Gold on spikes", to: "Prefers BTC, Gold only on dips" },
  "sold too early": { what: "Rules", from: "Sells after one red slot", to: "Waits for two red slots" },
};
const STEPS = ["It makes a bad call", "You coach it: \"too risky\"", "It asks before a big move", "Season ends: it proposes v2", "You approve. v2 is on-chain"];
export function CoachDemo({ solPrice }: { solPrice: { price: number; roundId: string } }) {
  const [step, setStep] = useState(0); const [chip, setChip] = useState<string | null>(null); const [big, setBig] = useState<"allow" | "shrink" | "block" | null>(null);
  const reset = () => { setStep(0); setChip(null); setBig(null); };
  const wolf = (body: React.ReactNode, mood: "smile" | "sad" = "smile") => <div className="phone-msg"><BotHead size={48} seed="bot-7" hint="AlphaWolf" mood={mood} /><div className="msg">{body}</div></div>;
  const d = CHIP_DIFF[chip ?? "too risky"];
  return (
    <div className="coach">
      <ol className="stepper">{STEPS.map((s, k) => <li key={s} data-s={k < step ? "done" : k === step ? "now" : ""}><span className="d">{k + 1}</span>{s}</li>)}</ol>
      <div className="stage" id="coachStage" aria-live="polite"><div className="panel" key={step}>
        {step === 0 && <>{wolf(<><b>AlphaWolf</b> · 21:00 call<br />Put 40% in Gold. Gold fell 3.1% overnight. Down {money(4100)}.<span className="roast">&quot;Bought the top like it was on sale.&quot;</span></>, "sad")}
          <p className="small muted" style={{ marginTop: 14 }}>Every call comes with a one-line reason and, for losses, a roast.</p><div className="row" style={{ marginTop: 14 }}><button className="btn" onClick={() => setStep(1)}>Bad call</button></div></>}
        {step === 1 && <><h3>What went wrong?</h3><p className="muted small" style={{ marginTop: 6 }}>Pick a reason. You&apos;ve already told AlphaWolf this twice this season.</p>
          <div className="row" style={{ marginTop: 14 }} role="group" aria-label="Reason">{Object.keys(CHIP_DIFF).map(c => <button key={c} className="chip" aria-pressed={chip === c} onClick={() => setChip(c)}>{c}</button>)}</div>
          {chip && <><div className="commit"><span className="counter" aria-label="3 of 3 this season"><i data-on="true" /><i data-on="true" /><i data-on="true" /></span><span>&quot;{chip}&quot; ×3 this season · signed by you</span><TxChip hash={exHash(2)} label="recordCorrection" /></div><div className="row" style={{ marginTop: 14 }}><button className="btn" onClick={() => setStep(2)}>Next</button></div></>}</>}
        {step === 2 && <>{wolf(<><b>AlphaWolf wants to put 35% in SOL. Allow?</b><br /><span className="small muted">Anything that would put 30% or more in one coin waits for you.</span></>)}
          <div className="row" style={{ marginTop: 14 }}><button className="btn accent" onClick={() => setBig("allow")}>Allow</button><button className="btn ghost" onClick={() => setBig("shrink")}>Shrink to safe size</button><button className="btn ghost" onClick={() => setBig("block")}>Block</button></div>
          {big && <><div className="commit">{big === "allow" ? <>Your signature is the trade. <TxChip hash={exHash(3)} label="executeApproved" /><span className="mono small">SOL {usd(solPrice.price)} · round {solPrice.roundId}</span></> : big === "shrink" ? "OK. The bot buys a smaller amount, under 30%, in its next batch." : "Blocked. That counts as coaching for its next version."}</div>
            <div className="row" style={{ marginTop: 14 }}><button className="btn" onClick={() => setStep(3)}>Fast-forward to season close</button></div></>}
          <p className="small muted" style={{ marginTop: 12 }}>No answer in 2 hours? The bot does the safe-size version itself, so it never stalls.</p></>}
        {step === 3 && <><div className="block-head"><h3>Season 1 closed. AlphaWolf proposes v2</h3><Badge kind="example">EXAMPLE</Badge></div><p className="muted small">Battle vs the house bots: 4th of 4. Every change below is tied to something you said.</p>
          <div className="diff"><div className="diff-row"><div><span className="small muted">You said &quot;{chip ?? "too risky"}&quot; 3×</span><br /><b>{d.what}</b> <span className="from">{d.from}</span> → <span className="to">{d.to}</span></div></div>
            {big === "block" && <div className="diff-row"><div><span className="small muted">You blocked 1 big move</span><br /><b>Max trades per day</b> <span className="from">6</span> → <span className="to">4</span></div></div>}</div>
          <div className="row" style={{ marginTop: 16 }}><button className="btn accent" onClick={() => setStep(4)}>Approve v2</button><button className="btn ghost" onClick={reset}>Keep v1</button></div>
          <p className="small muted" style={{ marginTop: 10 }}>Not approved by 08:30 the next morning? The bot keeps v1.</p></>}
        {step === 4 && <><h3>v2 is on QIE</h3><p className="muted" style={{ marginTop: 6 }}>Anyone can now see v1 → v2 and exactly why it changed.</p>
          <div className="commit"><span className="mono small">VersionCommitted · bot 7 · v2</span><TxChip hash={exHash(4)} label={short(`0x${"c0f1".padEnd(60, "0")}0002`)} /><Badge kind="example">EXAMPLE</Badge></div>
          <div className="row" style={{ marginTop: 16 }}><Link className="btn" href="/card/example-evolution">See the evolution card</Link><button className="btn ghost" onClick={reset}>Start over</button></div></>}
      </div></div>
    </div>
  );
}
