/** Server components for proof data. Each one renders its own loading/empty/error state. */
import { ASSETS, explorerAddress, type AssetId } from "@botfolio/shared";
import { DnaBot as BotHead } from "./DnaBot";
import { Badge, ErrorFallback, Placeholder, StatusBadge, TxChip } from "./ui";
import { assetLabel, e8ToNumber, inr, istTime, priceDecimals, short, usd } from "@/lib/site/format";
import { SAMPLE_BOTS } from "@/lib/site/sample";
import type { ActivityStats, ContractInfo, Loaded, Trade } from "@/lib/site/types";

export function ContractsTable({ contracts }: { contracts: ContractInfo[] }) {
  return (
    <>
      <div className="scroll" tabIndex={0} aria-label="Contracts"><table>
        <thead><tr><th>Contract</th><th>What it does</th><th>Address</th><th>Status</th></tr></thead>
        <tbody>{contracts.map(c => (
          <tr key={c.name}><td><b className="mono">{c.name}</b></td><td>{c.what}</td>
            <td>{c.address ? <a className="tx" href={explorerAddress(c.address)} target="_blank" rel="noopener">{short(c.address)}</a> : <Placeholder>ADDRESS, ~NOV 22</Placeholder>}</td>
            <td>{c.address ? <Badge kind="verified">VERIFIED</Badge> : <Badge kind="coming">DEPLOYS ~NOV 22</Badge>}</td></tr>
        ))}</tbody></table></div>
      <p className="small muted" style={{ marginTop: 10 }}>Addresses fill in from the deploy env and each links to its verified source on mainnet.qie.digital.</p>
    </>
  );
}

export function FeedsTable() {
  return (
    <div className="scroll" tabIndex={0} aria-label="Oracle feeds"><table>
      <thead><tr><th>Asset</th><th>Quote</th><th>Feed address</th><th>Max age</th><th>Status</th></tr></thead>
      <tbody>{ASSETS.map(a => (
        <tr key={a.id}><td><b>{a.label}</b></td><td>{a.id} / {a.quote}</td><td><a className="tx" href={explorerAddress(a.feed)} target="_blank" rel="noopener">{short(a.feed)}</a></td><td className="nowrap">{a.maxAgeSeconds >= 3600 ? `${a.maxAgeSeconds / 3600} h` : `${a.maxAgeSeconds / 60} min`}</td><td><Badge kind="verified">ON</Badge></td></tr>
      ))}</tbody></table></div>
  );
}

export function LatestTrades({ trades }: { trades: Loaded<Trade[]> }) {
  if (trades.status === "error") return <ErrorFallback what="Latest trades" source={trades.source} />;
  if (trades.status === "notlive" || !trades.data)
    return <div className="tile"><div className="k">Latest trades</div><p style={{ marginTop: 8 }}><b>Nothing yet, and that&apos;s honest.</b> Contracts deploy for Season 1; the first trade shows up here when the first bot is born.</p></div>;
  if (trades.data.length === 0) return <div className="tile"><div className="k">Latest trades</div><p style={{ marginTop: 8 }}>No trades in the last slot. Bots held, probably sulking.</p></div>;
  return (
    <>
      <div className="block-head"><div className="row"><h3>Latest trades</h3><StatusBadge status={trades.status} /></div>{trades.updatedAt && <span className="small muted">Updated {istTime(trades.updatedAt)}{trades.status === "example" ? " (example)" : ""}</span>}</div>
      <div className="card"><ul className="feed">{trades.data.map(t => {
        const b = t.bot ?? (trades.status === "example" ? SAMPLE_BOTS[t.botId] : undefined) ?? { id: t.botId, name: `Bot #${t.botId}`, emoji: "", isHouse: false, ownerWallet: "0x" as `0x${string}`, color: undefined };
        return <li key={t.txHash}><BotHead size={40} bot={b} /><div><div className="what">{b.name}{b.isHouse && <> <Badge kind="house">HOUSE</Badge></>} {t.side === "BUY" ? "bought" : "sold"} {inr(t.inrDisplay)} of {assetLabel(t.asset as AssetId)}</div>
          <div className="meta"><span className="nowrap">{istTime(t.blockTime)}</span><span className="mono nowrap">{usd(e8ToNumber(t.priceE8), priceDecimals(t.asset))}</span><span className="mono nowrap">round {t.roundId}</span><span className="nowrap">{t.userSigned ? <b>signed by owner</b> : "sent by runner"}</span></div></div><TxChip hash={t.txHash} /></li>;
      })}</ul></div>
    </>
  );
}

const USER_TILES: [keyof ActivityStats, string, string][] = [["uniqueSigners", "Unique signers", "wallets that signed anything"], ["userSignedTxs", "User-signed txs", "all user actions below"], ["botsCreated", "Bots created", "createBot"], ["corrections", "Coaching corrections", "recordCorrection"], ["v2Approvals", "v2 approvals", "commitVersion"], ["approvedBigMoves", "Approved big moves", "executeApproved"], ["dailyCalls", "Daily calls", "DailyCall.call"], ["challenges", "Challenges", "create + accept"]];
export function ActivityPanel({ stats }: { stats: Loaded<ActivityStats> }) {
  if (stats.status === "error") return <ErrorFallback what="Activity numbers" source={stats.source} />;
  const d = stats.data;
  const v = (n?: number) => (d && n !== undefined ? n.toLocaleString("en-IN") : "—");
  return (
    <>
      <div className="block-head"><div className="row"><h3>User-signed</h3>{d ? <StatusBadge status={stats.status} /> : <Badge kind="coming">COUNTING STARTS AT DEPLOY</Badge>}</div>{stats.updatedAt && d && <span className="small muted">Updated {istTime(stats.updatedAt)}</span>}</div>
      <div className="grid g4">{USER_TILES.map(([k, label, sub]) => <div className="tile" key={k}><div className="k">{label}</div><div className="v">{v(d?.[k] as number | undefined)}</div><div className="s mono">{sub}</div></div>)}</div>
      <div className="block-head" style={{ marginTop: 24 }}><div className="row"><h3>System</h3><span className="small muted">never added to the numbers above</span></div></div>
      <div className="grid g3">
        <div className="tile"><div className="k">Runner batches</div><div className="v">{v(d?.system.runnerBatches)}</div><div className="s mono">executeBatch</div></div>
        <div className="tile"><div className="k">Daily call settlements</div><div className="v">{v(d?.system.dailyCallSettlements)}</div><div className="s mono">DailyCall.settle</div></div>
        <div className="tile"><div className="k">Season roots</div><div className="v">{v(d?.system.seasonRoots)}</div><div className="s mono">closeSeason + commitScores</div></div>
      </div>
      {!d && <p className="small muted" style={{ marginTop: 12 }}>No numbers until there are real ones. These fill in from indexed chain events once the contracts and worker are live.</p>}
    </>
  );
}
