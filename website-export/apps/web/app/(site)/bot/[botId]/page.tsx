import type { Metadata } from "next";
import Link from "next/link";
import { BotHead } from "@/components/site/BotHead";
import { Badge, ErrorFallback, PriceAge, StatusBadge, TxChip } from "@/components/site/ui";
import { getBotRecord } from "@/lib/site/data";
import { arrow, assetLabel, botColor, e8ToNumber, inr, istTime, pct, priceDecimals, short, upDown, usd } from "@/lib/site/format";
import { SAMPLE_PRICES } from "@/lib/site/sample";
import type { AssetId } from "@botfolio/shared";
import type { Holding } from "@/lib/site/types";

function PriceCell({ x, price, age }: { x: Holding & { asset: AssetId }; price: number | null; age: number | null }) {
  if (price === null || age === null) return <span className="small muted">price pending</span>;
  return <><span className="mono small">{usd(price, priceDecimals(x.asset))}</span><br /><PriceAge asset={x.asset} ageMin={age} /></>;
}

export const revalidate = 60;
type P = { params: Promise<{ botId: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { botId } = await params;
  const r = await getBotRecord(Number(botId));
  const name = r.data?.bot.name ?? `Bot #${botId}`;
  return { title: name, description: `${name}'s full record on QIE: every call with its reason, every trade with its oracle round, every version.` };
}

const FN = ["Follows its rules", "Drawdown control", "Consistency", "Explains its trades"];

export default async function BotPage({ params }: P) {
  const { botId } = await params;
  const rec = await getBotRecord(Number(botId));
  if (rec.notFound) return (
    <section className="band tight"><div className="wrap"><div className="card stack" style={{ maxWidth: 640 }}>
      <BotHead size={72} color="#9AA0AD" mood="sad" /><h1 style={{ fontSize: "clamp(28px,4vw,40px)" }}>No bot with that id</h1>
      <p className="muted">It may not exist yet, or the link has a typo. Bot ids are numbers, like /bot/12.</p>
      <div className="row"><Link className="btn" href="/leaderboards">Browse the leaderboards</Link><Link className="btn ghost" href="/#try">Make your own</Link></div>
    </div></div></section>
  );
  if (rec.status === "error") return <section className="band tight"><div className="wrap"><ErrorFallback what="This bot's page" source={rec.source} /></div></section>;
  if (rec.status === "notlive" || !rec.data) return (
    <section className="band tight"><div className="wrap"><div className="card stack" style={{ maxWidth: 680 }}>
      <h1 style={{ fontSize: "clamp(28px,4vw,40px)" }}>Bot pages open with the app</h1>
      <p className="muted">Every bot gets a public page like this: holdings, every decision with its reason, every trade with its oracle round and tx, versions with config hashes, and its trust score. First ones appear ~Nov 25.</p>
    </div></div></section>
  );
  const r = rec.data, b = r.bot;
  // Live records carry priceE8 + priceAgeMin per holding; only EXAMPLE pages fall back to sample prices.
  const ex = rec.status === "example";
  const priceOf = (x: Holding & { asset: AssetId }) => (x.priceE8 ? e8ToNumber(x.priceE8) : ex ? SAMPLE_PRICES[x.asset].price : null);
  const ageOf = (x: Holding & { asset: AssetId }) => x.priceAgeMin ?? (ex ? SAMPLE_PRICES[x.asset].ageMin : null);
  const h2 = { margin: "36px 0 14px", fontSize: "clamp(24px,3vw,32px)" } as const;
  return (
    <section className="band tight enter"><div className="wrap">
      <div className="block-head"><Link href="/leaderboards" className="small">← Leaderboards</Link><StatusBadge status={rec.status} exampleText="EXAMPLE BOT" /></div>
      <div className="card bot-hero">
        <BotHead size={96} color={botColor(b.id, b.color)} emoji={b.emoji} />
        <div><h1 style={{ fontSize: "clamp(30px,4.4vw,48px)" }}>{b.name}</h1><p className="muted">{b.personaText ? `"${b.personaText}" · ` : ""}bot #{b.id} · v{r.versions[0]?.version ?? 1}</p>
          <p className="small mono muted" style={{ marginTop: 4 }}>owner {b.qieName ?? short(b.ownerWallet)} {!b.qieName && <Badge kind="coming">.qie NAME COMING</Badge>}</p></div>
        <div className="bv"><p className="small muted">Play value</p><p style={{ font: "800 clamp(30px,4vw,42px)/1 var(--f-display)" }}>{inr(r.valueInr)}</p><p className={upDown(r.seasonReturnPct)}><b>{arrow(r.seasonReturnPct)} {pct(r.seasonReturnPct)}</b> <span className="muted small">this season</span></p></div>
      </div>
      <div className="grid g2" style={{ marginTop: 20, alignItems: "start" }}>
        <div className="card"><div className="block-head"><h3>Holdings</h3><span className="small muted">marked at the last call</span></div>
          <div className="scroll" style={{ border: 0 }} tabIndex={0} aria-label="Holdings"><table style={{ minWidth: 0 }}><thead><tr><th>Asset</th><th className="num">Weight</th><th className="num">Value</th><th>Price</th></tr></thead><tbody>
            {r.holdings.map(x => <tr key={x.asset}><td><b>{assetLabel(x.asset)}</b></td><td className="num"><span className="weight" style={{ width: x.weightPct * 1.4, background: x.asset === "CASH" ? "var(--line-2)" : undefined }} />{x.weightPct}%</td><td className="num">{inr(x.inrDisplay)}</td>
              <td>{x.asset === "CASH" ? <span className="small muted">play USDT</span> : <PriceCell x={x as Holding & { asset: AssetId }} price={priceOf(x as Holding & { asset: AssetId })} age={ageOf(x as Holding & { asset: AssetId })} />}</td></tr>)}
          </tbody></table></div></div>
        <div className="card"><div className="block-head"><h3>Trust score</h3><span style={{ font: "800 30px var(--f-display)" }}>{r.trust.total}<span className="small muted"> / 1000</span></span></div>
          <div className="bars">{[r.trust.fRules, r.trust.fDrawdown, r.trust.fConsistency, r.trust.fExplains].map((v, i) => <div className="bar" key={FN[i]}><span>{FN[i]}</span><b>{v}/250</b><span className="tr"><i style={{ width: `${v / 2.5}%` }} /></span></div>)}</div>
          <p className="small muted" style={{ marginTop: 12 }}>Rules: <span className="mono">{r.trust.rulesVersion}</span>{r.trust.provisional ? " · new bot, provisional" : ""}.</p></div>
      </div>
      <h2 style={h2}>Every call, with its reason</h2>
      <ul className="decisions">{r.decisions.map(d => <li key={d.slotTime}><span className="slot">{istTime(d.slotTime)}</span><div>
        <div className="row" style={{ gap: 8 }}><Badge kind={d.status === "executed" ? "verified" : "house"}>{d.status === "executed" ? "TRADED" : d.status === "held" ? "HELD" : d.status === "skipped_stale" ? "HELD · PRICE TOO OLD" : "HELD · NO VALID ANSWER"}</Badge><span className="mono small muted">{d.reasonTag}</span></div>
        <p className="r" style={{ marginTop: 6 }}>{d.reason}</p>{d.roast && <p className="ro">&quot;{d.roast}&quot;</p>}</div></li>)}</ul>
      <h2 style={h2}>Trades on QIE</h2>
      <div className="scroll" tabIndex={0} aria-label="Trades"><table><thead><tr><th>When</th><th>Trade</th><th className="num">Size</th><th className="num">Oracle price</th><th className="num">Round</th><th>Tx</th></tr></thead><tbody>
        {r.trades.map(t => <tr key={t.txHash}><td className="nowrap">{istTime(t.blockTime)}</td><td>{t.side === "BUY" ? "Bought" : "Sold"} {assetLabel(t.asset)}{t.userSigned && <> <Badge kind="verified">OWNER-SIGNED</Badge></>}</td><td className="num">{inr(t.inrDisplay)}</td><td className="num mono">{usd(e8ToNumber(t.priceE8), priceDecimals(t.asset))}</td><td className="num mono">{t.roundId}</td><td><TxChip hash={t.txHash} /></td></tr>)}
      </tbody></table></div>
      <h2 style={h2}>How it learned</h2>
      <div className="versions">{r.versions.map(v => <div className="ver" key={v.version}><div className="vh"><h4>v{v.version} · {v.source === "create" ? "created" : "approved"} {v.approvedAt ? istTime(v.approvedAt) : ""}</h4>{v.committedTx ? <TxChip hash={v.committedTx} label={short(v.configHash)} /> : <span className="mono small">{short(v.configHash)}</span>}</div>
        {v.changes?.length ? v.changes.map(c => <p key={c.what} style={{ marginTop: 8 }}><span className="small muted">{c.because} →</span> <b>{c.what} {c.from} → {c.to}</b></p>) : <p style={{ marginTop: 8 }} className="muted">{v.rulesText}</p>}</div>)}</div>
      <div className="row" style={{ marginTop: 28 }}><Link className="btn" href="/proof#prp">Replay this season</Link><Link className="btn ghost" href="/#try">Make a bot to challenge it</Link></div>
    </div></section>
  );
}
