"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BotPageView } from "@/components/bot/BotPageView";
import { ErrorNote } from "@/components/create/controls";
import { fetchBotPage, istTime, type BotPage } from "@/lib/bot-record";
import { getOwnerConfig, type OwnerConfig } from "@/lib/config";
import { REGISTRY_ABI } from "@/lib/create-bot";
import { userMessage } from "@/lib/errors";
import { fetchBigMoves, fetchDailyCall, fetchOwner, type DailyCallToday, type OwnerBot, type PendingBigMove } from "@/lib/owner";
import { createChainClient } from "@/lib/relay-call";
import { useOwnerSession } from "@/lib/use-owner-session";
import type { WalletSession } from "@/lib/wallet";
import { BigMoveCard } from "./BigMoveCard";
import { DailyCallCard } from "./DailyCallCard";
import { ChallengeButton, CorrectCall, PauseToggle, type OwnerCtx } from "./OwnerActions";
import { NotLive, SignInCard } from "./relay-ui";
import { ThinkingFeed } from "./ThinkingFeed";

export type MeData =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "no_bot" }
  /** On-chain but not indexed yet: the worker's page appears within a minute. */
  | { kind: "not_indexed"; botId: string }
  | {
      kind: "ok";
      page: BotPage;
      /** null = that owner read failed; the rest still shows. */
      owner: OwnerBot | null;
      daily: DailyCallToday | null;
      moves: PendingBigMove[];
    };

const card = "flex flex-col gap-3 rounded-r3 border border-line bg-surface p-4 shadow-card";
const h2 = "font-display text-xl font-extrabold";

export async function loadMe(config: OwnerConfig, session: WalletSession): Promise<MeData> {
  const registry = config.targets.BotRegistry;
  if (!registry) return { kind: "error", message: "BotFolio's contracts aren't connected to this site yet." };
  let botId: bigint;
  try {
    botId = await createChainClient().readContract({ address: registry, abi: REGISTRY_ABI, functionName: "botOf", args: [session.address] });
  } catch {
    return { kind: "error", message: "Can't reach QIE right now. Please try again." };
  }
  if (botId === 0n) return { kind: "no_bot" };
  const id = botId.toString();
  const w = config.workerUrl;
  const [page, owner, daily, moves] = await Promise.allSettled([fetchBotPage(id, w), fetchOwner(w, session), fetchDailyCall(w, session), fetchBigMoves(w, session)]);
  if (page.status === "rejected" || page.value.kind === "error" || page.value.kind === "busy") return { kind: "error", message: "Your bot's record didn't load. Please try again in a minute." };
  if (page.value.kind === "not_found") return { kind: "not_indexed", botId: id };
  if (page.value.kind === "not_live") return { kind: "error", message: "Bot pages aren't switched on yet." };
  const ok = <T,>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);
  return {
    kind: "ok",
    page: page.value.page,
    owner: ok(owner)?.find((b) => b.botId === id) ?? null,
    daily: ok(daily),
    moves: (ok(moves) ?? []).filter((m) => m.botId === id),
  };
}

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** The signed-in body of /me, once loaded. Split out so its states render in tests without a wallet. */
export function MeView({ data, ctx, now, onReload }: { data: MeData; ctx: OwnerCtx; now: number; onReload: () => void }) {
  if (data.kind === "loading") {
    return (
      <div role="status" className={card}>
        <div aria-hidden="true" className="flex animate-pulse items-center gap-3">
          <span className="size-14 rounded-r2 bg-surface-2" />
          <span className="h-6 w-2/3 rounded-r1 bg-surface-2" />
        </div>
        <p className="text-sm text-muted">Loading your bot…</p>
      </div>
    );
  }
  if (data.kind === "error") {
    return (
      <div className="flex flex-col gap-3">
        <ErrorNote>{data.message}</ErrorNote>
        <button type="button" onClick={onReload} className="min-h-11 self-start font-semibold text-accent-ink">
          Try again
        </button>
      </div>
    );
  }
  if (data.kind === "no_bot") {
    return (
      <section className={card}>
        <h2 className={h2}>No bot yet</h2>
        <p className="text-muted">Describe one in a sentence. It takes about 30 seconds and zero real money is at risk.</p>
        <Link href="/" className="inline-flex h-12 items-center justify-center rounded-full bg-accent px-6 font-semibold text-on-accent">
          Make my bot
        </Link>
      </section>
    );
  }
  if (data.kind === "not_indexed") {
    return (
      <section role="status" className={card}>
        <h2 className={h2}>Bot #{data.botId} is on QIE</h2>
        <p className="text-muted">Its page shows up here within a minute, once we&apos;ve read it from the chain.</p>
        <button type="button" onClick={onReload} className="min-h-11 self-start font-semibold text-accent-ink">
          Check again
        </button>
      </section>
    );
  }

  const { page, owner, daily, moves } = data;
  const botId = page.bot.id;
  const dailyBot = daily?.bots.find((b) => b.botId === botId);
  const proposal = owner?.proposal;
  const season = page.seasons[0];

  const panel = (
    <>
      {moves.map((m) => (
        <BigMoveCard key={m.orderId} ctx={ctx} move={m} now={now} />
      ))}
      <section aria-labelledby="controls" className={card}>
        <h2 id="controls" className={h2}>
          Your controls
        </h2>
        <PauseToggle ctx={ctx} botId={botId} status={page.bot.status} />
        <Link href={`/bot/${botId}`} className="min-h-11 self-start font-semibold text-accent-ink">
          See its public page
        </Link>
      </section>
      <ThinkingFeed page={page} now={now} />
      {owner ? (
        <DailyCallCard ctx={ctx} bot={owner} state={dailyBot?.state ?? (daily ? "waiting" : null)} closesAt={daily?.closesAt ?? null} now={now} />
      ) : (
        <NotLive>Daily Call and your season scores didn&apos;t load. Reload the page in a minute.</NotLive>
      )}
      <section aria-labelledby="season" className={card}>
        <h2 id="season" className={h2}>
          Season
        </h2>
        {proposal ? (
          <>
            <p>
              Your bot&apos;s v{proposal.version} is ready: {proposal.config.changes.length || "no"} change{proposal.config.changes.length === 1 ? "" : "s"} from your coaching.
            </p>
            <p className="text-xs text-muted">Approve by {istTime(proposal.approveBy)}, or it keeps v{proposal.config.from.version}.</p>
            <Link href={`/season/${proposal.config.season}`} className="inline-flex h-12 items-center justify-center rounded-full bg-accent px-6 font-semibold text-on-accent">
              See the v{proposal.version} diff
            </Link>
          </>
        ) : season ? (
          <Link href={`/season/${season.season}`} className="min-h-11 self-start font-semibold text-accent-ink">
            Season {season.season} result
          </Link>
        ) : (
          <p className="text-sm text-muted">Your first season result comes at the next close (21:30 IST).</p>
        )}
      </section>
      <section aria-labelledby="challenge" className={card}>
        <h2 id="challenge" className={h2}>
          Challenge a friend
        </h2>
        <ChallengeButton ctx={ctx} botId={botId} />
      </section>
    </>
  );

  return (
    <BotPageView
      page={page}
      afterBot={panel}
      callAction={(d) => <CorrectCall key={d.id} ctx={ctx} botId={botId} decisionUuid={d.id} />}
    />
  );
}

/** S3 /me (SPEC §2.4, #77): the owner's bot, its prompts and every coaching action. */
export function MeScreen() {
  const [config] = useState(getOwnerConfig);
  const { available, session, busy, error, signIn } = useOwnerSession();
  const [data, setData] = useState<MeData>({ kind: "loading" });
  const now = useNow();

  const load = useCallback(() => {
    if (!config || !session) return;
    loadMe(config, session).then(setData, (e: unknown) => setData({ kind: "error", message: userMessage(e) }));
  }, [config, session]);
  useEffect(load, [load]);
  const reload = () => {
    setData({ kind: "loading" });
    load();
  };

  if (!config) {
    return <NotLive>BotFolio&apos;s contracts and relayer aren&apos;t connected to this site yet.</NotLive>;
  }
  if (!session) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Your bot</h1>
        <SignInCard available={available} busy={busy} error={error} onSignIn={signIn} why="Sign in to see your bot, answer its prompts and coach it." />
      </div>
    );
  }
  return <MeView data={data} ctx={{ config, session }} now={now} onReload={reload} />;
}
