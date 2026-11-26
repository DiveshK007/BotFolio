"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PrimaryButton } from "@/components/create/controls";
import { ActionStatus, NotLive, SessionLoading, SignInCard, useRelay } from "@/components/me/relay-ui";
import { loadMe, MeView, type MeData } from "@/components/me/MeScreen";
import type { OwnerCtx } from "@/components/me/OwnerActions";
import { bpsPct, istTime } from "@/lib/bot-record";
import { getOwnerConfig } from "@/lib/config";
import { userMessage } from "@/lib/errors";
import { shortHex } from "@/lib/format";
import type { OwnerBot } from "@/lib/owner";
import { useSession } from "@/lib/wallet";

const card = "flex flex-col gap-3 rounded-r3 border border-line bg-surface p-4 shadow-card";
const h2 = "font-display text-xl font-extrabold";
const pct = (bps: number) => bpsPct(bps, false);

type Proposal = NonNullable<OwnerBot["proposal"]>;

/** The diff the owner approves (SPEC §2.3 step 3): every limit and rule change, each tied to a correction or the results. */
export function V2Diff({ p }: { p: Proposal }) {
  const c = p.config;
  const rows: [string, string, string][] = [];
  if (c.from.max_per_coin_bps !== c.max_per_coin_bps) rows.push(["Max per coin", pct(c.from.max_per_coin_bps), pct(c.max_per_coin_bps)]);
  if (c.from.max_trades_per_day !== c.max_trades_per_day) rows.push(["Max trades a day", String(c.from.max_trades_per_day), String(c.max_trades_per_day)]);
  return (
    <div className="flex flex-col gap-3">
      {rows.length > 0 && (
        <ul className="flex flex-col gap-1">
          {rows.map(([what, from, to]) => (
            <li key={what} className="flex flex-wrap items-baseline justify-between gap-2">
              <span>{what}</span>
              <span className="tabular-nums">
                <s className="text-muted">{from}</s> → <b>{to}</b>
              </span>
            </li>
          ))}
        </ul>
      )}
      {c.changes.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {c.changes.map((x, i) => (
            <li key={i} className="[overflow-wrap:anywhere]">
              <bdi>{x.what}</bdi> <span className="text-muted">· {x.because_correction_id > 0 ? "from your coaching" : "from the season's results"}</span>
            </li>
          ))}
        </ul>
      )}
      {c.from.rules !== c.rules && (
        <div className="grid gap-2 text-sm">
          <p className="rounded-r2 bg-surface-2 p-3 text-muted [overflow-wrap:anywhere]">
            <span className="font-semibold">v{c.from.version}: </span>
            <bdi>{c.from.rules}</bdi>
          </p>
          <p className="rounded-r2 bg-accent-soft p-3 [overflow-wrap:anywhere]">
            <span className="font-semibold">v{c.version}: </span>
            <bdi>{c.rules}</bdi>
          </p>
        </div>
      )}
      <p className="text-xs text-muted">
        Config hash <span className="font-mono text-ink">{shortHex(p.configHash)}</span>. Approving commits exactly this hash on QIE.
      </p>
    </div>
  );
}

/** #83: Approve → SeasonLedger.commitVersion; done only when the on-chain VersionCommitted hash equals this one. */
function Approve({ ctx, botId, p }: { ctx: OwnerCtx; botId: string; p: Proposal }) {
  const relay = useRelay(ctx.config, ctx.session);
  if (!ctx.config.targets.SeasonLedger) return <NotLive>Approving isn&apos;t switched on yet.</NotLive>;
  const c = p.config;
  const approve = () =>
    relay.run({ kind: "commitVersion", botId: BigInt(botId), version: p.version, hash: p.configHash, maxPerCoinBps: c.max_per_coin_bps, maxTradesPerDay: c.max_trades_per_day });
  return (
    <>
      {relay.phase.name !== "done" && (
        <PrimaryButton disabled={relay.busy} onClick={approve}>
          Approve v{p.version}
        </PrimaryButton>
      )}
      <ActionStatus phase={relay.phase} done={`v${p.version} is live. The hash on QIE matches.`} onRecheck={relay.recheck} />
    </>
  );
}

/** The season close for the owner's bot (S5). */
export function SeasonView({ n, data, ctx }: { n: number; data: MeData; ctx: OwnerCtx }) {
  // Loading, error and no-bot states are the same as /me (they never use `now`).
  if (data.kind !== "ok") return <MeView data={data} ctx={ctx} now={0} onReload={() => location.reload()} />;
  const { page, owner } = data;
  const result = page.seasons.find((s) => s.season === n);
  const proposal = owner?.proposal?.config.season === n ? owner.proposal : null;
  const current = page.versions[0]?.version ?? 1;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold tracking-tight">
        Season {n} · <bdi>{page.bot.name}</bdi>
      </h1>
      <section aria-labelledby="battle" className={card}>
        <h2 id="battle" className={h2}>
          Battle result
        </h2>
        {result ? (
          <>
            <p className="font-display text-3xl font-extrabold">
              {result.battle_rank !== null ? `#${result.battle_rank} of 4` : "Not ranked"}
              <span className="ml-2 text-base font-normal text-muted">vs the 3 house bots</span>
            </p>
            <p>
              <b className={result.return_bps < 0 ? "text-down" : "text-up"}>{bpsPct(result.return_bps)}</b>
              <span className="text-muted"> · max drop {pct(result.max_dd_bps)} · {result.trades} trades</span>
            </p>
            <p className="text-xs text-muted">Marked at the 21:00 slot, settled against QIE&apos;s official mainnet oracle.</p>
          </>
        ) : (
          <p className="text-muted">No result for season {n} yet. Seasons close at 21:30 IST.</p>
        )}
        <Link href={`/leaderboards?season=${n}`} className="min-h-11 self-start font-semibold text-accent-ink">
          Season {n} leaderboards
        </Link>
      </section>

      <section aria-labelledby="v2" className={card}>
        <h2 id="v2" className={h2}>
          {proposal ? `Your bot's v${proposal.version}` : "Next version"}
        </h2>
        {proposal ? (
          <>
            <V2Diff p={proposal} />
            <p className="text-sm">
              Approve by <b>{istTime(proposal.approveBy)}</b>, or your bot keeps v{proposal.config.from.version}.
            </p>
            <Approve ctx={ctx} botId={page.bot.id} p={proposal} />
          </>
        ) : (
          <p className="text-muted">Nothing waiting for you. Your bot runs v{current}. A new version is proposed at each season close, until 08:30 IST the next morning.</p>
        )}
      </section>
      <Link href="/me" className="min-h-11 self-start font-semibold text-accent-ink">
        Back to your bot
      </Link>
    </div>
  );
}

export function SeasonScreen({ n }: { n: number }) {
  const [config] = useState(getOwnerConfig);
  const { session, loading } = useSession();
  const [data, setData] = useState<MeData>({ kind: "loading" });
  const load = useCallback(() => {
    if (!config || !session) return;
    loadMe(config, session).then(setData, (e: unknown) => setData({ kind: "error", message: userMessage(e) }));
  }, [config, session]);
  useEffect(load, [load]);

  if (!config) return <NotLive>BotFolio&apos;s contracts and relayer aren&apos;t connected to this site yet.</NotLive>;
  if (!session) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Season {n}</h1>
        {loading ? <SessionLoading /> : <SignInCard why="Sign in to see your bot's season result and approve its next version." />}
        <Link href={`/leaderboards?season=${n}`} className="min-h-11 self-start font-semibold text-accent-ink">
          Season {n} leaderboards
        </Link>
      </div>
    );
  }
  return <SeasonView n={n} data={data} ctx={{ config, session }} />;
}
