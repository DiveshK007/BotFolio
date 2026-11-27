import Link from "next/link";
import type { Metadata } from "next";
import { CopyButton } from "@/components/site/chrome";
import { JudgesTour } from "@/components/site/interactive";
import { Attract } from "@/components/site/extras";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SAMPLE_BOTS } from "@/lib/site/sample";
import { arenaRacers } from "@/lib/site/live";
import { judgesActivity, judgesTrades } from "@/lib/site/judges";
import { ActivityPanel, ContractsTable, LatestTrades } from "@/components/site/proof";
import { Badge, Icon } from "@/components/site/ui";
import { START_CASH_LINE } from "@/lib/site/format";
import { getContracts } from "@/lib/site/data";

export const metadata: Metadata = { title: "For judges: the 90-second tour", description: "What BotFolio is, live QIE mainnet proof, QIE components used, and user-signed traction." };
// Live trades and traction: render per request so a cached page never shows old numbers. Worker fetches keep their own cache.
export const dynamic = "force-dynamic";
const SENTENCE = "Raise an AI trader in one sentence, coach it every season, and let QIE keep score.";
// Only an https link is shown; the env is ours, but a typo must not become a javascript: href.
const VIDEO = /^https:\/\//.test(process.env.NEXT_PUBLIC_DEMO_VIDEO_URL ?? "") ? process.env.NEXT_PUBLIC_DEMO_VIDEO_URL : null;

// QIE components: flip `coming` to `verified` only after WS D confirms each in docs/qie-components.md (SPEC §0.6).
// QIE Wallet stays IN TESTING until signTypedData_v4 on chain 1990 is checked by a person (#99).
const makeComps = (allLive: boolean): [string, string, "verified" | "coming", string][] => [
  ["QIE mainnet", allLive ? "All 7 contracts live on chain 1990. Chain facts checked Nov 19." : "All 7 contracts target chain 1990. Chain facts checked Nov 19; deploying for Season 1.", "verified", "CHAIN VERIFIED"],
  ["QIE Oracles", "5 feeds read inside PaperLedger and DailyCall at trade time. Prices are never passed in.", "verified", "FEEDS VERIFIED"],
  ["QIE Wallet connect", "Second login next to passkey. Same signed requests, still zero gas. Signing on chain 1990 is still being tested.", "coming", "IN TESTING"],
  ["QIE ID / .qie names", "Shows name.qie instead of 0x… for bot owners. Reverse lookup checked live on mainnet Nov 26 2026.", "verified", "VERIFIED NOV 26"],
  ["QIE Wallet MCP", "The worker looks up .qie names through its read-only qie_reverse_lookup tool. Checked live Nov 27 2026.", "verified", "VERIFIED NOV 27"],
  ["QIE Pass", "Optional \"verified human\" badge on leaderboards. Never gates play. Needs partner access.", "coming", "COMING"],
];

export default async function Judges() {
  const contracts = getContracts();
  const deployed = contracts.filter(c => c.address !== null).length;
  const allLive = deployed === contracts.length;
  const comps = makeComps(allLive);
  // Worker reads (HANDOFF #2): GET /stats for traction, /leaderboards + /bot-page for trades.
  const [trades, stats, racers] = await Promise.all([judgesTrades(), judgesActivity(), arenaRacers()]);
  // The attract march is decoration: real bots from the board when there are any, else the example cast.
  const march = racers.example
    ? [3, 12, 7, 1, 2, 21, 41, 52, 58, 33].map(id => ({ id: String(id), name: SAMPLE_BOTS[id].name }))
    : racers.data.map(r => ({ id: String(r.id), name: r.name, dnaSeed: r.dnaSeed }));
  return (
    <>
      <SiteHeader current="/judges" />
      <main className="bf" style={{ position: "relative" }}>
      <Attract ids={march} />
      <JudgesTour />
      <section className="tour-sec" id="t1"><div className="wrap grid g2" style={{ alignItems: "center" }}>
        <div className="stack"><p className="kicker"><b>1</b>What it is</p><h2>Anyone raises an AI trader in one sentence, coaches it, and QIE keeps score.</h2>
          <p className="lede">BotFolio, built for QIE Hackathon 3.0 (Mainnet Edition), AI + Autonomous Agents track. Bots paper-trade BTC, ETH, SOL, XRP and Gold with play money, 4 times a day.</p>
          <p><b>What&apos;s new:</b> AI paper trading exists already. What doesn&apos;t: you coach your bot, and every version of its brain is committed on-chain, so the record shows how it learned from you.</p></div>
        <div className="card" style={{ background: "var(--paper)" }}><p className="small muted" style={{ marginBottom: 8 }}>The hero moment <Badge kind="example">EXAMPLE</Badge></p><p style={{ font: "800 clamp(22px,2.6vw,30px)/1.15 var(--f-display)" }}>You said &quot;too risky&quot; 3× → max per coin 40% → 25%</p><p className="mono small muted" style={{ marginTop: 12 }}>config hash committed on QIE</p></div>
      </div></section>
      <section className="tour-sec" id="t2"><div className="wrap stack">
        <p className="kicker"><b>2</b>Live mainnet proof</p><h2>{allLive ? "Real contracts live on QIE mainnet" : deployed > 0 ? `${deployed} of ${contracts.length} contracts live on QIE mainnet` : "Real contracts on QIE mainnet, deploying for Season 1"}</h2>
        <p className="lede">{allLive ? "All 7 contracts are deployed on chain 1990. Each address below links to its record on the explorer." : "The 7 contracts deploy and get verified for Season 1. Until an address is set in env, this panel says so rather than showing anything made up."}</p>
        <p className="small muted">{START_CASH_LINE}</p>
        <ContractsTable contracts={contracts} />
        <LatestTrades trades={trades} />
      </div></section>
      <section className="tour-sec" id="t3"><div className="wrap stack">
        <p className="kicker"><b>3</b>QIE pieces used, and where</p><h2>Oracles at the core. The rest labelled honestly.</h2>
        <div className="comp-list">{comps.map(([n, w, b, l]) => <div className="comp" key={n}><h4>{n}</h4><Badge kind={b}>{l}</Badge><p className="w">{w}</p></div>)}</div>
      </div></section>
      <section className="tour-sec" id="t4"><div className="wrap stack">
        <p className="kicker"><b>4</b>User-signed traction</p><h2>We count people by who signed, not by how many txs our bots sent</h2>
        <p className="lede">User-signed means bots created, coaching corrections, v2 approvals, approved big moves, daily calls and challenges, counted by the signer&apos;s address. Runner and settlement txs are shown separately.</p>
        <ActivityPanel stats={stats} />
      </div></section>
      <section className="tour-sec" id="t5"><div className="wrap stack">
        <p className="kicker"><b>5</b>Why blockchain</p><h2>Because a screenshot proves nothing</h2>
        <div className="grid g3">
          <div className="card"><h4>Anyone can check</h4><p className="muted small">Verify on QIE on every card: tx, oracle round, version hash.</p></div>
          <div className="card"><h4>Agents can read it</h4><p className="muted small">Public API plus a read-only BotFolio MCP server.</p></div>
          <div className="card"><h4>It outlives us</h4><p className="muted small">History stays on QIE; the replay script recomputes it.</p></div>
        </div>
      </div></section>
      <section className="tour-sec" id="t6"><div className="wrap stack">
        <p className="kicker"><b>6</b>The one sentence to remember</p>
        <p className="remember">{SENTENCE}</p>
        <div className="row"><CopyButton text={SENTENCE} label="Copy the sentence" className="btn" />
          <a className="btn ghost" href="https://github.com/DiveshK007/BotFolio" rel="noopener">Repo</a><Link className="btn ghost" href="/proof">Proof page</Link></div>
        {VIDEO && <a className="poster" style={{ maxWidth: 560 }} href={VIDEO} rel="noopener"><div><div className="play"><Icon name="play" size={26} /></div><b>Demo video, 3 minutes</b><p className="small muted">Recorded on QIE mainnet. Anything not live is labelled.</p></div></a>}
      </div></section>
      </main>
    </>
  );
}
