"use client";

import Link from "next/link";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { ErrorNote } from "@/components/create/controls";
import { getWorkerUrl } from "@/lib/config";
import { userMessage } from "@/lib/errors";
import {
  BOARDS,
  fetchLeaderboards,
  formatBps,
  formatSortino,
  winRate,
  type BoardEntry,
  type BoardKey,
  type Leaderboards,
  type LeaderboardsAnswer,
} from "@/lib/leaderboards";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; answer: LeaderboardsAnswer };

/** Why a board can be empty: its SPEC §8 eligibility, in plain words. */
const EMPTY: Record<BoardKey, string> = {
  topReturns: "No bot has a mark this season yet. The board fills after the first slot.",
  bestRiskAdjusted: "No bot qualifies yet. It takes 3 executed trades and 3 daily returns this season.",
  mostTrusted: "No bot qualifies yet. It takes one completed season and enough trades: 8 in sprint seasons, 20 in weekly ones.",
  coachVsBot: "No owner qualifies yet. It takes 2 Daily Calls with a result in a sprint season, 4 in a weekly one.",
};

export function LeaderboardsView({ season }: { season: number | null }) {
  const [workerUrl] = useState(getWorkerUrl);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<BoardKey>("topReturns");

  useEffect(() => {
    if (!workerUrl) return;
    const controller = new AbortController();
    fetchLeaderboards(workerUrl, season, controller.signal).then(
      (answer) => setLoad({ status: "ready", answer }),
      (e) => controller.signal.aborted || setLoad({ status: "error", message: userMessage(e) }),
    );
    return () => controller.abort();
  }, [workerUrl, season, attempt]);

  if (!workerUrl) return <p className="mt-6 text-muted">Leaderboards aren&apos;t switched on yet.</p>;
  if (load.status === "loading") return <Skeleton />;
  if (load.status === "error") {
    return (
      <div className="mt-6 flex flex-col gap-3">
        <ErrorNote>{load.message}</ErrorNote>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold"
            onClick={() => {
              setLoad({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
          {season !== null && (
            <Link href="/leaderboards" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-accent-ink underline">
              Current season
            </Link>
          )}
        </div>
      </div>
    );
  }

  const { boards, currentSeason } = load.answer;
  return (
    <>
      <SeasonBar boards={boards} currentSeason={currentSeason} />
      <Tabs tab={tab} onChange={setTab} />
      <section id={`board-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="mt-4">
        <Board boards={boards} tab={tab} />
      </section>
      <p className="mt-6 text-xs text-muted">
        House bots are shown with a badge but never ranked, so #1 is always a human-raised bot. Returns are marked against QIE&apos;s official
        mainnet oracle. Recognition only.
      </p>
    </>
  );
}

function SeasonBar({ boards, currentSeason }: { boards: Leaderboards; currentSeason: number }) {
  const { season, live } = boards;
  const href = (n: number) => (n === currentSeason ? "/leaderboards" : `/leaderboards?season=${n}`);
  const nav = "inline-flex min-h-11 items-center px-1 text-sm font-semibold text-accent-ink";
  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        {season > 0 ? (
          <Link href={href(season - 1)} className={nav} aria-label={`Season ${season - 1}`}>
            ‹ S{season - 1}
          </Link>
        ) : (
          <span />
        )}
        <p className="flex flex-wrap items-center justify-center gap-2 text-center">
          <b className="font-display text-lg">Season {season}</b>
          {live ? (
            <span className="rounded-full bg-amber-soft px-2 py-0.5 text-xs font-semibold text-ink">Live · provisional</span>
          ) : (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted ring-1 ring-line">Final</span>
          )}
        </p>
        {season < currentSeason ? (
          <Link href={href(season + 1)} className={nav} aria-label={`Season ${season + 1}`}>
            S{season + 1} ›
          </Link>
        ) : (
          <span />
        )}
      </div>
      {live && <p className="text-center text-xs text-muted">Ranks move with every slot until the season closes at 21:30 IST.</p>}
    </div>
  );
}

function Tabs({ tab, onChange }: { tab: BoardKey; onChange: (t: BoardKey) => void }) {
  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const i = (BOARDS.findIndex((b) => b.key === tab) + step + BOARDS.length) % BOARDS.length;
    onChange(BOARDS[i]!.key);
    document.getElementById(`tab-${BOARDS[i]!.key}`)?.focus();
  };
  return (
    <div role="tablist" aria-label="Boards" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" onKeyDown={onKey}>
      {BOARDS.map((b) => {
        const on = b.key === tab;
        return (
          <button
            key={b.key}
            id={`tab-${b.key}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={`board-${b.key}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(b.key)}
            className={`min-h-11 rounded-r2 px-2 py-2 text-sm font-semibold leading-tight ${
              on ? "bg-ink text-paper" : "border border-line bg-surface text-ink"
            }`}
          >
            {b.label}
          </button>
        );
      })}
    </div>
  );
}

function Board({ boards, tab }: { boards: Leaderboards; tab: BoardKey }) {
  const note =
    tab === "mostTrusted" && boards.trustSeason !== boards.season ? (
      <p className="mb-3 text-xs text-muted">
        {boards.trustSeason === null
          ? "No season has been scored yet."
          : `Scores from season ${boards.trustSeason}, the latest scored. This season's come at its close.`}
      </p>
    ) : null;
  const rows = renderRows(boards, tab);
  return (
    <>
      {note}
      {rows.length ? <ol className="flex flex-col gap-2">{rows}</ol> : <p className="rounded-r2 border border-line bg-surface-2 p-4 text-sm text-muted">{EMPTY[tab]}</p>}
    </>
  );
}

function renderRows(b: Leaderboards, tab: BoardKey): ReactNode[] {
  switch (tab) {
    case "topReturns":
      return b.topReturns.map((e) => (
        <Row key={e.botId} entry={e} metric={<Signed bps={e.returnBps} />} detail={`Max drawdown ${formatBps(e.maxDdBps, false)}`} />
      ));
    case "bestRiskAdjusted":
      return b.bestRiskAdjusted.map((e) => (
        <Row key={e.botId} entry={e} metric={<span className="tabular-nums">{formatSortino(e.sortino)}</span>} detail={`Return ${formatBps(e.returnBps)}`} />
      ));
    case "mostTrusted":
      return b.mostTrusted.map((e) => (
        <Row key={e.botId} entry={e} metric={<span className="tabular-nums">{e.total}</span>} detail="of 1000" />
      ));
    case "coachVsBot":
      // SPEC §8: the human's score, not the bot's.
      return b.coachVsBot.map((e) => (
        <Row
          key={e.botId}
          entry={e}
          metric={<span className="tabular-nums">{winRate(e)}</span>}
          detail={`${e.ownerQieName ?? "Owner"} ${e.you} – ${e.name} ${e.bot} · ${e.calls} calls`}
        />
      ));
  }
}

function Signed({ bps }: { bps: number }) {
  return <span className={`tabular-nums ${bps > 0 ? "text-up" : bps < 0 ? "text-down" : ""}`}>{formatBps(bps)}</span>;
}

function Row({ entry, metric, detail }: { entry: BoardEntry; metric: ReactNode; detail: string }) {
  return (
    <li>
      <Link
        href={`/bot/${entry.botId}`}
        className="flex min-h-14 items-center gap-3 rounded-r2 border border-line bg-surface px-3 py-2 shadow-card active:scale-[.99]"
      >
        <span className="w-9 shrink-0 text-center font-display text-lg font-extrabold tabular-nums">
          {entry.rank === null ? <span className="sr-only">Unranked</span> : `#${entry.rank}`}
        </span>
        <span className="text-2xl" aria-hidden="true">
          {entry.emoji}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="truncate">{entry.name}</b>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted">
            {entry.isHouse && <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-semibold ring-1 ring-line">house</span>}
            {entry.rank === 1 && <span className="whitespace-nowrap rounded-full bg-sun-soft px-1.5 text-[11px] font-semibold text-ink">Top human-raised bot</span>}
            {!entry.isHouse && entry.ownerQieName && <span className="truncate">{entry.ownerQieName}</span>}
          </span>
          <span className="text-xs text-muted">{detail}</span>
        </span>
        <span className="shrink-0 whitespace-nowrap text-lg font-semibold">{metric}</span>
      </Link>
    </li>
  );
}

function Skeleton() {
  return (
    <div className="mt-4 flex flex-col gap-2" aria-busy="true" aria-label="Loading leaderboards">
      <div className="mx-auto h-6 w-40 animate-pulse rounded-r1 bg-surface-2" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-11 animate-pulse rounded-r2 bg-surface-2" />
        ))}
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-r2 bg-surface-2" />
      ))}
    </div>
  );
}
