import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { LeaderboardsView } from "@/components/leaderboards/LeaderboardsView";
import { parseSeasonParam } from "@/lib/leaderboards";

export const metadata: Metadata = {
  title: "Leaderboards",
  description: "Top Returns, Best Risk-Adjusted (Sortino), Most Trusted and Coach vs Bot, season by season. Play money. Not investment advice. No prizes.",
};

// S6 (SPEC §2.4, §8). The boards are fetched in the browser from the worker; ?season=<n> picks a past one.
export default async function LeaderboardsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const season = parseSeasonParam((await searchParams).season);
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-xl px-4 pb-12 pt-4">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Leaderboards</h1>
        <LeaderboardsView key={season ?? "current"} season={season} />
      </main>
    </>
  );
}
