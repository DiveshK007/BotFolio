import type { Metadata } from "next";
import { CopyButton } from "@/components/site/chrome";
import { ActivityPanel, ContractsTable, FeedsTable, LatestTrades, PricesTable } from "@/components/site/proof";
import { Badge, Placeholder } from "@/components/site/ui";
import { getActivity, getContracts, getLatestTrades, getOraclePrices } from "@/lib/site/data";

export const metadata: Metadata = { title: "Proof and activity on QIE mainnet", description: "BotFolio's 7 contracts, 5 QIE oracle feeds, the oracle caveat, user-signed vs system activity, trust rules and replay." };
export const revalidate = 60;
const REPLAY = "npx botfolio-replay season-1.jsonl";

export default async function Proof() {
  const [trades, stats, prices] = await Promise.all([getLatestTrades(), getActivity(), getOraclePrices()]);
  const jump = [["pc", "Contracts"], ["pf", "Price feeds"], ["pcav", "Oracle caveat"], ["stats", "Activity"], ["ptr", "Trust score"], ["prp", "Replay a season"]];
  return (
    <>
      <section className="band tight enter"><div className="wrap stack">
        <h1>Don&apos;t trust us. Check.</h1>
        <p className="lede">Everything a bot does that matters is on QIE mainnet. This page lists the contracts, the price feeds, what the oracle can and can&apos;t promise, and how to recompute a whole season yourself.</p>
        <nav className="row" aria-label="Jump to section">{jump.map(([id, l]) => <a key={id} className="chip" href={`#${id}`}>{l}</a>)}</nav>
      </div></section>
      <section className="band tight" id="pc"><div className="wrap">
        <div className="section-head"><div><h2>7 contracts, all verified on the explorer</h2><p className="lede">Solidity 0.8.24, OpenZeppelin 5.0.2. Feed addresses are fixed at deploy, with no setter, so prices can&apos;t be swapped.</p></div></div>
        <ContractsTable contracts={getContracts()} />
      </div></section>
      <section className="band tight alt" id="pf"><div className="wrap">
        <div className="section-head"><div><h2>Five price feeds, read inside the contract</h2><p className="lede">QIE&apos;s oracle feeds, read with <span className="mono">latestRoundData()</span> at trade time. Crypto is quoted in USDT, gold in USD, all with 8 decimals.</p></div><Badge kind="verified">ADDRESSES VERIFIED NOV 19</Badge></div>
        <FeedsTable />
        <PricesTable prices={prices} />
        <p className="small muted" style={{ marginTop: 10 }}>QIE and BNB feeds exist but are switched off in BotFolio.</p>
      </div></section>
      <section className="band tight" id="pcav"><div className="wrap grid g2" style={{ alignItems: "start" }}>
        <div className="stack"><h2>What the oracle can and can&apos;t promise</h2>
          <p>All five feeds are updated by one QIE-operated wallet. So our wording is exact: trades are <b>settled against QIE&apos;s official mainnet oracle</b>. We don&apos;t call that anything grander.</p>
          <p>Feeds sometimes go quiet. On Nov 19 we measured crypto gaps of up to 144 minutes and gold gaps of over 6 hours. When a price is too old, the bot holds that asset and says so (&quot;Gold market quiet — holding&quot;). It never trades on a stale price.</p></div>
        <div className="card stack"><h4>How price age is shown</h4>
          <p><span className="age">BTC $63,922.95 · round 50887 · 1m old</span></p><p><span className="age amber">▲ Gold price 3h old</span></p><p><span className="age grey">Holding — price too old</span></p>
          <p className="small muted">Under 60 min: muted. 60 min or more: amber. Past the limit (30 min crypto, 6 h gold): grey, no trade. <Badge kind="example">EXAMPLE values</Badge></p></div>
      </div></section>
      <section className="band tight alt" id="stats"><div className="wrap">
        <div className="section-head"><div><h2>Activity: people first, robots second</h2><p className="lede">User-signed txs are counted by the signer&apos;s address. System txs (runner batches, settlements, season roots) are listed apart and never added to user numbers.</p></div></div>
        <ActivityPanel stats={stats} />
        <div style={{ marginTop: 24 }}><LatestTrades trades={trades} /></div>
      </div></section>
      <section className="band tight" id="ptr"><div className="wrap">
        <div className="section-head"><div><h2>Trust score: 0 to 1000, four public rules</h2><p className="lede">Rules version <span className="mono">trust-v1</span>, published on-chain. Each factor is worth 250. New bots are marked &quot;new&quot; until they have 8 trades and one finished season (20 trades from Season 6).</p></div></div>
        <div className="scroll" tabIndex={0} aria-label="Trust score rules"><table><thead><tr><th>Factor</th><th>What it measures</th><th>Formula</th></tr></thead><tbody>
          <tr><td><b>Follows its rules</b></td><td>Proposed actions that pass the risk gate unclipped</td><td className="mono small">250 × (1 − clipped / proposed)</td></tr>
          <tr><td><b>Drawdown control</b></td><td>Small peak-to-trough drops</td><td className="mono small">250 × max(0, 1 − maxDD / 0.30)</td></tr>
          <tr><td><b>Consistency</b></td><td>Calm daily returns</td><td className="mono small">250 × max(0, 1 − σ_daily / 0.04)</td></tr>
          <tr><td><b>Explains its trades</b></td><td>Reasons that name the asset and match the action</td><td className="mono small">250 × valid / executed</td></tr>
        </tbody></table></div>
      </div></section>
      <section className="band tight alt" id="prp"><div className="wrap grid g2" style={{ alignItems: "start" }}>
        <div className="stack"><h2>Replay a season yourself</h2>
          <p>Each season gets a replay file with every decision, the logged AI output, the risk-gate result, oracle round ids and tx hashes. Its Merkle root is committed on QIE at season close.</p>
          <p>The honest claim: AI output isn&apos;t guaranteed to repeat, so we log it. <b>Given the logged output, everything after it is deterministic and recomputable.</b></p>
          <p className="small muted">Season 1 closes Nov 27, 21:30 IST. First replay file after that. <Placeholder>REPLAY FILE URL</Placeholder></p></div>
        <div className="code"><CopyButton text={REPLAY} /><pre><span className="c"># re-runs the risk gate, re-reads oracle rounds from QIE,{"\n"}# recomputes balances, marks, boards and trust scores,{"\n"}# and checks the root against the on-chain record</span>{"\n"}{REPLAY}</pre></div>
      </div></section>
    </>
  );
}
