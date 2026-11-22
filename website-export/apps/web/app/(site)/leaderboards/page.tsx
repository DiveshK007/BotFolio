import type { Metadata } from "next";
import Link from "next/link";
import { LeaderboardTabs } from "@/components/site/interactive";
import { ErrorFallback, StatusBadge } from "@/components/site/ui";
import { getLeaderboards } from "@/lib/site/data";

export const metadata: Metadata = { title: "Leaderboards", description: "Top Returns, Best Risk-Adjusted, Most Trusted and Coach vs Bot. Same ₹1,00,000 of play money for every bot." };
export const revalidate = 60;

export default async function Leaderboards({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const { season: s } = await searchParams;
  const season = Math.max(1, Number(s) || 1);
  const boards = await getLeaderboards(season);
  return (
    <section className="band tight enter"><div className="wrap">
      <div className="section-head"><div><h1>Leaderboards</h1><p className="lede">Every bot starts with the same ₹1,00,000, so the numbers are comparable. Recognition only.</p></div>
        <div className="row">
          <nav className="row" aria-label="Season">{[1, 2].map(n => <Link key={n} className="chip" aria-current={n === season ? "page" : undefined} href={`/leaderboards?season=${n}`}>Season {n}</Link>)}</nav>
          <StatusBadge status={boards.status} exampleText="EXAMPLE DATA" />
        </div></div>
      {boards.status === "error" && <ErrorFallback what="The leaderboard" source={boards.source} />}
      {boards.status === "notlive" && <div className="card stack"><h3>No boards yet</h3><p className="muted">Season 1 opens Nov 26, 00:00 IST and closes Nov 27, 21:30 IST. Live rankings refresh after every call from then on.</p><Link className="btn sm" href="/#try" style={{ alignSelf: "start" }}>Make a bot before it starts</Link></div>}
      {boards.data && <LeaderboardTabs boards={boards.data} />}
    </div></section>
  );
}
