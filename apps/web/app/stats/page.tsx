import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { istTime } from "@/lib/bot-record";
import { fetchStats, SYSTEM_KINDS, USER_ACTIONS, type ActivityStats } from "@/lib/stats";

export const metadata: Metadata = {
  title: "Stats",
  description: "BotFolio activity on QIE mainnet: actions users signed themselves, counted by signer, and our system txs shown apart.",
};

// Live counts: render per request so a cached page never shows old numbers. The worker fetch keeps its own 60 s cache.
export const dynamic = "force-dynamic";

const card = "rounded-r3 border border-line bg-surface p-4 shadow-card";
const n = (v: number) => v.toLocaleString("en-US");

// SPEC §11 user-signed tx metric (#92). Server-rendered from the worker's public GET /stats (#107).
export default async function StatsPage() {
  const result = await fetchStats();
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 pb-12 pt-4">
        <section className="flex flex-col gap-3">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Stats</h1>
          <p className="text-muted">
            What happens on QIE mainnet, in two separate piles. <b className="text-ink">User-signed</b> are actions a person signed with their own
            wallet. <b className="text-ink">System</b> are txs our runner and committer send. We never add the two together.
          </p>
        </section>
        {result.kind === "ok" ? (
          <StatsView stats={result.stats} />
        ) : (
          <section className={card}>
            <h2 className="font-display text-xl font-extrabold">{result.kind === "not_live" ? "Stats aren't live yet" : "We couldn't load the stats"}</h2>
            <p className="mt-2 text-muted">
              {result.kind === "not_live"
                ? "They go live with the contracts on QIE mainnet. Check back soon."
                : "The numbers didn't come back. Try again in a minute. Every tx is on QIE mainnet either way."}
            </p>
          </section>
        )}
        <HowWeCount />
      </main>
    </>
  );
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-r2 border border-line bg-surface p-3">
      <b className="font-display text-2xl font-extrabold tabular-nums">{n(value)}</b>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

function StatsView({ stats }: { stats: ActivityStats }) {
  const u = stats.userSigned;
  return (
    <>
      <section aria-labelledby="user" className="flex flex-col gap-3">
        <h2 id="user" className="font-display text-xl font-extrabold">User-signed</h2>
        <div className="grid grid-cols-2 gap-2">
          <Tile value={u.byAction.createBot.wallets} label="Wallets that created a bot" />
          <Tile value={u.txs} label="User-signed txs" />
          <Tile value={u.active30d} label="Active wallets, last 30 days" />
          <Tile value={u.recurring} label="Wallets active in 2+ seasons" />
          <Tile value={u.active7d} label="Active wallets, last 7 days" />
          <Tile value={u.signers} label="Wallets that signed anything" />
        </div>
        <ul className={`${card} flex flex-col divide-y divide-line py-1`}>
          {USER_ACTIONS.map(({ key, label }) => (
            <li key={key} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
              <span>{label}</span>
              <span className="shrink-0 text-right tabular-nums">
                <b>{n(u.byAction[key].txs)}</b> <span className="text-muted">· {n(u.byAction[key].wallets)} wallets</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="system" className="flex flex-col gap-3">
        <h2 id="system" className="font-display text-xl font-extrabold">System</h2>
        <p className="text-sm text-muted">Sent by our own keys. This is not user activity.</p>
        <ul className={`${card} flex flex-col divide-y divide-line py-1`}>
          {SYSTEM_KINDS.map(({ key, label }) => (
            <li key={key} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
              <span>{label}</span>
              <b className="tabular-nums">{n(stats.system.byKind[key])}</b>
            </li>
          ))}
          <li className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm font-semibold">
            <span>All system txs</span>
            <span className="tabular-nums">{n(stats.system.txs)}</span>
          </li>
        </ul>
      </section>
      <p className="text-xs text-muted">Counted at {istTime(stats.asOf)}. Updates every minute.</p>
    </>
  );
}

function HowWeCount() {
  return (
    <section aria-labelledby="how" className="flex flex-col gap-3 text-sm">
      <h2 id="how" className="font-display text-xl font-extrabold">How we count</h2>
      <p className="text-muted">
        Every number counts contract events our indexer read from QIE mainnet, so you can recount them from the chain. A user is the wallet each
        contract checked as the signer (<code className="font-mono">_msgSender</code>, the bot&apos;s owner). It is never the address that paid the gas,
        which is our relayer. House bots are left out because the admin key owns them.
      </p>
      <dl className="flex flex-col gap-2">
        {USER_ACTIONS.map(({ key, label, counts }) => (
          <div key={key}>
            <dt className="font-semibold">{label}</dt>
            <dd className="text-muted">{counts}</dd>
          </div>
        ))}
        {SYSTEM_KINDS.map(({ key, label, counts }) => (
          <div key={key}>
            <dt className="font-semibold">{label} (system)</dt>
            <dd className="text-muted">{counts}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted">
        &quot;Active&quot; means at least one user-signed action in the window, and a season is S1 onward. Challenges carry no time, so they count in
        the totals but not in the active or 2+ seasons numbers. A Daily Call is dated to its IST day. A big move is dated to when it was proposed,
        which is at most 2 hours before the owner approved it. Pausing a bot isn&apos;t counted. Every gap here makes a number lower, never higher.
      </p>
    </section>
  );
}
