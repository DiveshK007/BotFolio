import Link from "next/link";
import { CoachDemo, HowItWorks, Mascot, TryBot, type PriceMap } from "@/components/site/demos";
import { LatestTrades, PricesTable, SeasonCountdown } from "@/components/site/proof";
import { Badge, Placeholder } from "@/components/site/ui";
import { getLatestTrades, getOraclePrices } from "@/lib/site/data";
import { e8ToNumber } from "@/lib/site/format";
import { SAMPLE_PRICES } from "@/lib/site/sample";

export const revalidate = 60;

export default async function Home() {
  const [trades, prices] = await Promise.all([getLatestTrades(), getOraclePrices()]);
  // The try widget uses live oracle prices when the RPC answers; otherwise its EXAMPLE prices.
  const priceMap: PriceMap = prices.status === "live" && prices.data
    ? Object.fromEntries(prices.data.map(r => [r.asset, { price: e8ToNumber(r.answerE8), roundId: r.roundId, ageMin: (Date.now() - Date.parse(r.updatedAt)) / 60000 }])) as PriceMap
    : SAMPLE_PRICES;
  const appUrl = process.env.SITE_DATA_MODE === "live" ? process.env.APP_URL ?? null : null;
  return (
    <>
      <section className="hero enter">
        <div className="wrap hero-grid">
          <div>
            <h1>Raise an AI trader in <span className="hl">one sentence</span>.</h1>
            <p className="lede" style={{ marginTop: 18 }}>Coach it every season and let QIE keep score. Every bot starts with ₹1,00,000 of play money, and every trade it makes is recorded on QIE mainnet.</p>
            <div className="pitch-points" aria-label="Key facts"><span>5 assets: BTC, ETH, SOL, XRP, Gold</span><span>4 calls a day</span><span>No gas, no seed phrase</span></div>
            <Mascot />
          </div>
          <TryBot prices={priceMap} appUrl={appUrl} />
        </div>
      </section>

      <section className="band alt" id="how" aria-labelledby="howH"><div className="wrap"><HowItWorks /></div></section>

      <section className="band" id="coach" aria-labelledby="coachH"><div className="wrap">
        <div className="section-head"><div><h2 id="coachH">Your AI trader. Your rules. Your fault.</h2><p className="lede">You don&apos;t write code. You tell it when it messed up, and once a season it proposes a better version of itself. You approve, and that version is committed on QIE.</p></div><Badge kind="example">EXAMPLE walkthrough</Badge></div>
        <CoachDemo solPrice={priceMap.SOL as { price: number; roundId: string }} />
      </div></section>

      <section className="band alt" aria-labelledby="proofH"><div className="wrap">
        <div className="section-head"><div><h2 id="proofH">No fake screenshots. Every trade on-chain.</h2><p className="lede">Prices are read by the contract from QIE&apos;s oracle at the moment of the trade. Nobody types them in, us included.</p></div><Link className="btn ghost sm" href="/proof">See all the proof</Link></div>
        <div className="grid g3" style={{ marginBottom: 16 }}><SeasonCountdown /></div>
        <LatestTrades trades={trades} />
        <PricesTable prices={prices} />
      </div></section>

      <section className="band why" aria-labelledby="whyH"><div className="wrap">
        <div className="section-head"><div><h2 id="whyH">Why a blockchain? Three reasons you can test</h2></div></div>
        <div className="grid g3">
          <article className="card"><div className="num">1</div><h3 style={{ marginTop: 10 }}>Anyone can check, not just us</h3><p className="muted">Every share card has a Verify on QIE button. A screenshot can be faked. The trade tx, the oracle round it was priced against and the version hash can&apos;t.</p><Link href="/card/example-roast" style={{ display: "inline-block", marginTop: 12 }}>Flip a card →</Link></article>
          <article className="card"><div className="num">2</div><h3 style={{ marginTop: 10 }}>Other apps and agents can read the record</h3><p className="muted">A public read API and a BotFolio MCP server let any app or AI agent fetch a bot&apos;s track record straight from chain data.</p><Link href="/developers" style={{ display: "inline-block", marginTop: 12 }}>Watch an agent check a bot →</Link></article>
          <article className="card"><div className="num">3</div><h3 style={{ marginTop: 10 }}>The record outlives the app</h3><p className="muted">The bot, its trades and its versions belong to the owner&apos;s address. If BotFolio shut down tomorrow, the history stays on QIE and the replay script still recomputes it.</p><Link href="/proof#prp" style={{ display: "inline-block", marginTop: 12 }}>How replay works →</Link></article>
        </div>
      </div></section>

      <section className="band alt moments" aria-labelledby="momH"><div className="wrap">
        <div className="section-head"><div><h2 id="momH">Something happens every day</h2><p className="lede">Four calls a day, and your bot has an opinion every time, even when it does nothing.</p></div></div>
        <div className="grid g4">
          {[
            ["\"Gold Guru wants 35% in Gold. Allow?\"", "Big moves wait for you. Allow it and your own signature is the trade. Ignore it for 2 hours and the bot does a smaller, safe version."],
            ["You vs your bot: BTC up or down by 21:00?", "Daily Call. You pick, then see the bot's pick. QIE's oracle settles it. Bragging rights only."],
            ["\"AlphaWolf is sulking in cash after Tuesday's gold mess.\"", "Even a hold comes with a reason in the bot's own voice. Losses come with a roast."],
            ["\"My bot vs yours, this season.\"", "Send a challenge link. Your friend makes a bot in 30 seconds and the season decides. No stakes."],
          ].map(([q, d]) => <article className="card" key={q}><span style={{ alignSelf: "start" }}><Badge kind="example">EXAMPLE</Badge></span><p className="q">{q}</p><p className="muted small">{d}</p></article>)}
        </div>
      </div></section>

      <section className="band" aria-labelledby="statusH"><div className="wrap">
        {/* Update this section by hand as milestones land (it is copy, not data). */}
        <div className="section-head"><div><h2 id="statusH">Where we actually are</h2><p className="lede">Built during QIE Hackathon 3.0, Nov 20 to Nov 30. Updated Nov 20.</p></div></div>
        <div className="status">
          <div className="card"><h3>What works today</h3><ul className="checks">
            <li><span className="ic ok">✓</span><span>QIE mainnet and its 5 oracle feeds checked live on Nov 19 (chain 1990, 8-decimal feeds, update gaps measured).</span></li>
            <li><span className="ic ok">✓</span><span>Full product and contract spec, with every unverified item marked.</span></li>
            <li><span className="ic ok">✓</span><span>Public repo with the build plan and contributor rules.</span></li>
            <li><span className="ic ok">✓</span><span>This website, with example data clearly marked.</span></li>
          </ul></div>
          <div className="card"><h3>What&apos;s next</h3><ol className="timeline">
            <li><span className="when">~Nov 22</span><span>7 contracts deployed and verified on QIE mainnet</span></li>
            <li><span className="when">~Nov 25</span><span>App opens. Soft launch with 20 people</span></li>
            <li><span className="when">Nov 26</span><span>Season 1 opens</span></li>
            <li><span className="when">Nov 27</span><span>Season 1 closes 21:30 IST. First v2 approvals</span></li>
            <li><span className="when">Later</span><span>QIE Wallet connect, .qie names, QIE Wallet MCP, QIE Pass badge <Badge kind="coming">COMING</Badge></span></li>
          </ol></div>
        </div>
      </div></section>

      <section className="band ink" aria-labelledby="nextH"><div className="wrap">
        <h2 id="nextH" style={{ marginBottom: 24 }}>Pick your next step</h2>
        <div className="next">
          <Link href="/#try"><span className="t">Try it</span><span className="s">Make an example bot above. The real app opens ~Nov 25.</span></Link>
          <Link href="/judges"><span className="t">Watch the demo</span><span className="s">Video lands after Season 1 <Placeholder>DEMO VIDEO URL</Placeholder></span></Link>
          <Link href="/proof"><span className="t">See the proof</span><span className="s">Contracts, oracle feeds, replay.</span></Link>
          <a href="https://github.com/DiveshK007/BotFolio" rel="noopener"><span className="t">Read the code</span><span className="s">github.com/DiveshK007/BotFolio</span></a>
        </div>
      </div></section>
    </>
  );
}

