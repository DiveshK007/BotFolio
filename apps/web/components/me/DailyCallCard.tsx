"use client";

import { useState } from "react";
import type { SignedDailyCallBotView } from "@botfolio/shared";
import { ExplorerLink } from "@/components/ui/ExplorerLink";
import { userMessage } from "@/lib/errors";
import { istTime } from "@/lib/bot-record";
import { viewForPick, type DailyCallState, type OwnerBot } from "@/lib/owner";
import type { OwnerCtx } from "./OwnerActions";
import { ActionStatus, NotLive, useRelay } from "./relay-ui";

const card = "flex flex-col gap-3 rounded-r3 border border-line bg-surface p-4 shadow-card";
const word = (up: boolean) => (up ? "Up" : "Down");
const IST_MS = 19_800_000;
/** 21:00 IST on `now`'s IST day: the settle slot (SPEC §4.7). */
const settleTime = (now: number) => Math.floor((now + IST_MS) / 86_400_000) * 86_400_000 - IST_MS + 21 * 3_600_000;

function Result({ today, botName, now }: { today: NonNullable<OwnerBot["calls"]["today"]>; botName: string; now: number }) {
  let line: string;
  if (today.settleTx) {
    const you = today.userCorrect === null ? "No winner: BTC didn't move" : today.userCorrect ? "You were right" : "You were wrong";
    const bot = today.botCorrect === null ? "" : today.botCorrect ? ` · ${botName} was right` : ` · ${botName} was wrong`;
    line = you + bot;
  } else {
    line = now >= settleTime(now) ? "Settles late: waiting for a fresh BTC round from QIE's official mainnet oracle." : "Settles after tonight's 21:00 slot.";
  }
  return (
    <div className="flex flex-col gap-1">
      <p>
        You said <b>{word(today.userUp)}</b> · <bdi>{botName}</bdi> said <b>{word(today.botUp)}</b>
      </p>
      <p className="text-sm text-muted">{line}</p>
      <p className="flex flex-wrap gap-2">
        <ExplorerLink tx={today.callTx} label="Your call on explorer" />
        {today.settleTx && <ExplorerLink tx={today.settleTx} label="Settlement" />}
      </p>
    </div>
  );
}

const WAIT: Record<Exclude<DailyCallState, "open" | "called">, string> = {
  waiting: "Your bot makes its call at 09:00 IST. Come back after.",
  joins_tomorrow: "Your bot joins tomorrow's call.",
  closed: "Today's call closed at 20:00 IST. Back tomorrow.",
};

/**
 * #81 Daily Call (S11). The bot's view is fetched only after the owner picks, and shown only once the owner has
 * signed, so nobody can read the bot's answer and then choose (SPEC §2.2). The tap signs DailyCall.call with the
 * runner-signed view; the contract records the oracle price itself.
 */
export function DailyCallCard({
  ctx,
  bot,
  state,
  closesAt,
  now,
}: {
  ctx: OwnerCtx;
  bot: OwnerBot;
  /** null = /daily-call didn't answer. */
  state: DailyCallState | null;
  closesAt: string | null;
  now: number;
}) {
  const relay = useRelay(ctx.config, ctx.session);
  const [pick, setPick] = useState<boolean | null>(null);
  const [view, setView] = useState<SignedDailyCallBotView | null>(null);
  const [locked, setLocked] = useState(false);
  const { calls } = bot;
  const p = relay.phase;
  // Past the signature: the call is the owner's now, so the bot's view may show.
  const signed = p.name === "done" || (p.name === "busy" && (p.step === "relaying" || p.step === "confirming")) || (p.name === "error" && Boolean(p.txHash));
  const canPick = pick === null || (p.name === "error" && !p.txHash); // a locked pick comes back on any tap

  async function choose(tapped: boolean) {
    setPick(tapped);
    let got: Awaited<ReturnType<typeof viewForPick>>;
    try {
      got = await viewForPick(ctx.config.workerUrl, ctx.session, bot.botId, tapped);
    } catch (e) {
      relay.fail(userMessage(e));
      return;
    }
    // Sign the pick the worker stored, which is the only one the relayer sends (PICK_MISMATCH otherwise).
    setPick(got.userUp);
    setLocked(got.locked);
    setView(got.view);
    await relay.run({ kind: "dailyCall", botId: BigInt(bot.botId), userUp: got.userUp, botUp: got.view.botUp, botSig: got.view.botSig });
  }

  let body;
  if (!ctx.config.targets.DailyCall) body = <NotLive>Daily Call isn&apos;t switched on yet.</NotLive>;
  else if (calls.today) body = <Result today={calls.today} botName={bot.name} now={now} />;
  else if (state === null) body = <NotLive>Today&apos;s call didn&apos;t load. Reload the page in a minute.</NotLive>;
  else if (state === "called") body = <p className="text-sm text-muted">You made today&apos;s call. It shows here once QIE has it.</p>;
  else if (state !== "open") body = <p className="text-sm text-muted">{WAIT[state]}</p>;
  else {
    body = (
      <>
        <p>BTC up or down by tonight&apos;s 21:00 slot?</p>
        {closesAt && <p className="text-xs text-muted">Closes at {istTime(closesAt)}. One call a day.</p>}
        <div className="grid grid-cols-2 gap-2">
          {[true, false].map((up) => (
            <button
              key={String(up)}
              type="button"
              aria-pressed={pick === up}
              disabled={!canPick}
              onClick={() => choose(up)}
              className={`min-h-12 rounded-full border-2 font-display text-lg font-extrabold disabled:opacity-60 ${up ? "border-up text-up" : "border-down text-down"} ${pick === up ? "bg-surface-2" : ""}`}
            >
              {up ? "▲ Up" : "▼ Down"}
            </button>
          ))}
        </div>
        {locked && pick !== null && (
          <p role="status" className="text-sm">
            You already picked <b>{pick ? "UP" : "DOWN"}</b> today, so that&apos;s your call.
          </p>
        )}
        {signed && view && pick !== null && (
          <p role="status" className="rounded-r2 bg-surface-2 p-3">
            You said <b>{word(pick)}</b>. <bdi>{bot.name}</bdi> says <b>{word(view.botUp)}</b>.
          </p>
        )}
        <ActionStatus phase={relay.phase} done="Your call is on QIE, priced by QIE's official mainnet oracle." onRecheck={relay.recheck} />
      </>
    );
  }

  return (
    <section aria-labelledby="daily-call" className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="daily-call" className="font-display text-xl font-extrabold">
          You vs your bot
        </h2>
        <p className="text-sm">
          You <b className="tabular-nums">{calls.you}</b> – <b className="tabular-nums">{calls.bot}</b> <bdi>{bot.name}</bdi>
          <span className="text-muted">{calls.season !== null ? ` · season ${calls.season}` : ""}</span>
        </p>
      </div>
      {calls.streak > 1 && <p className="text-xs text-muted">{calls.streak} right in a row.</p>}
      {body}
      <p className="text-xs text-muted">No stakes, no prizes. Bragging rights only.</p>
    </section>
  );
}
