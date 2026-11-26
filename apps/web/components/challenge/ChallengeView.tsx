import { ExplorerLink } from "@/components/ui/ExplorerLink";
import type { ChallengeSide, PublicChallenge } from "@/lib/owner";
import { ChallengeAccept } from "./ChallengeAccept";

const card = "flex flex-col gap-3 rounded-r3 border border-line bg-surface p-4 shadow-card";

function Bot({ side, won }: { side: ChallengeSide; won: boolean }) {
  return (
    <a href={`/bot/${side.botId}`} className="flex min-h-11 items-center gap-2 rounded-r2 bg-surface-2 p-3">
      <span aria-hidden="true" className="text-2xl">
        {side.emoji}
      </span>
      <b className="[overflow-wrap:anywhere]">
        <bdi>{side.name}</bdi>
      </b>
      {won && <span className="ml-auto rounded-full bg-sun-soft px-2 py-0.5 text-xs font-semibold">Won</span>}
    </a>
  );
}

/**
 * S10 challenge landing (SPEC §2.5). Bot names are LLM output from user text (#159): JSX text only.
 * No stakes, no prizes: the result is the two bots' returns over the same season.
 */
export function ChallengeView({ challenge: c }: { challenge: PublicChallenge }) {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold tracking-tight [overflow-wrap:anywhere]">
        <bdi>{c.challenger.name}</bdi> challenges your bot
      </h1>
      <section className={card}>
        <p className="text-sm text-muted">Season {c.season}: whichever bot returns more wins. Same oracle prices, no extra trading. Recognition only.</p>
        <Bot side={c.challenger} won={c.winnerBotId === c.challenger.botId} />
        {c.opponent ? <Bot side={c.opponent} won={c.winnerBotId === c.opponent.botId} /> : <p className="rounded-r2 border border-dashed border-line p-3 text-muted">Your bot here?</p>}
        <p className="flex flex-wrap gap-2">
          {c.createTx && <ExplorerLink tx={c.createTx} label="Challenge on explorer" />}
          {c.acceptTx && <ExplorerLink tx={c.acceptTx} label="Accepted on explorer" />}
        </p>
      </section>
      {c.status === "open" && <ChallengeAccept challenge={c} />}
      {c.status === "accepted" && <p className="text-sm">Accepted. The result comes at the season {c.season} close (21:30 IST).</p>}
      {c.status === "settled" && <p className="text-sm">Settled at the season {c.season} close. Rematch next season from your bot&apos;s page.</p>}
      {c.status === "expired" && <p className="text-sm text-muted">This challenge expired without an opponent.</p>}
    </div>
  );
}
