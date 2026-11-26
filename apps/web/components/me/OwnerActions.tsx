"use client";

import { decisionIdFromUuid } from "@botfolio/shared";
import { useState } from "react";
import { keccak256, stringToHex, zeroHash, type Hex } from "viem";
import { PrimaryButton } from "@/components/create/controls";
import type { OwnerConfig } from "@/lib/config";
import { userMessage } from "@/lib/errors";
import { saveCorrectionNote, shortCode } from "@/lib/owner";
import { CHIPS, createChainClient, SEASON_LEDGER_ABI } from "@/lib/relay-call";
import type { WalletSession } from "@/lib/wallet";
import { ActionStatus, NotLive, useRelay } from "./relay-ui";

export interface OwnerCtx {
  config: OwnerConfig;
  session: WalletSession;
}

const ghost = "inline-flex min-h-11 items-center justify-center rounded-full border border-line px-4 text-sm font-semibold disabled:opacity-60";

/** #191: BotRegistry.setActive through the forwarder. Paused bots are skipped by the runner. */
export function PauseToggle({ ctx, botId, status }: { ctx: OwnerCtx; botId: string; status: string }) {
  const relay = useRelay(ctx.config, ctx.session);
  if (status === "banned") return <p className="text-sm text-down">Stopped by the moderators. It can&apos;t trade.</p>;
  if (!ctx.config.targets.BotRegistry) return <NotLive>Pause isn&apos;t switched on yet.</NotLive>;
  // The page data catches up once the indexer has the event; until then the confirmed event is the truth.
  const done = relay.phase.name === "done" && relay.phase.event.eventName === "BotActiveChanged" ? relay.phase.event.args.active : null;
  const active = done ?? status === "active";
  const toggle = () => relay.run({ kind: "setActive", botId: BigInt(botId), active: !active });
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        {active ? "Your bot trades at 09:00, 13:00, 17:00 and 21:00 IST." : "Paused: your bot skips its calls until you resume it."}
      </p>
      <button type="button" className={ghost} disabled={relay.busy} onClick={toggle}>
        {active ? "Pause bot" : "Resume bot"}
      </button>
      <ActionStatus phase={relay.phase} done={active ? "Resumed on QIE." : "Paused on QIE."} onRecheck={relay.recheck} />
    </div>
  );
}

const SPOKEN_CHIPS = CHIPS.filter((c) => c !== "blocked");
const MAX_NOTE = 80;

/** #79: "Bad call" → chip + optional one-line reason → SeasonLedger.recordCorrection. Only the note's hash goes on-chain. */
export function CorrectCall({ ctx, botId, decisionUuid }: { ctx: OwnerCtx; botId: string; decisionUuid: string }) {
  const relay = useRelay(ctx.config, ctx.session);
  const [open, setOpen] = useState(false);
  const [chip, setChip] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  if (!ctx.config.targets.SeasonLedger) return null;
  if (relay.phase.name === "done") return <div className="mt-2"><ActionStatus phase={relay.phase} done="Correction on QIE. It feeds your bot's next version." /></div>;
  if (!open) {
    return (
      <button type="button" className={`${ghost} mt-2`} onClick={() => setOpen(true)}>
        Bad call
      </button>
    );
  }
  const text = note.trim();
  async function send() {
    if (chip === null) return;
    const noteHash: Hex = text ? keccak256(stringToHex(text)) : zeroHash;
    if (text) {
      setSaving(true);
      try {
        await saveCorrectionNote(ctx.config.workerUrl, ctx.session, { botId, decisionId: decisionUuid, chip, note: text, noteHash });
      } catch (e) {
        relay.fail(userMessage(e)); // nothing signed: fix the note, or send without one
        return;
      } finally {
        setSaving(false);
      }
    }
    await relay.run({ kind: "recordCorrection", botId: BigInt(botId), decisionId: decisionIdFromUuid(decisionUuid), noteHash, chip });
  }
  return (
    <fieldset className="mt-2 flex flex-col gap-2 rounded-r2 bg-surface-2 p-3" disabled={relay.busy || saving}>
      <legend className="sr-only">What was wrong with this call?</legend>
      <div className="flex flex-wrap gap-2">
        {SPOKEN_CHIPS.map((c) => {
          const id = CHIPS.indexOf(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={chip === id}
              onClick={() => setChip(id)}
              className={`min-h-11 rounded-full border px-3 text-sm ${chip === id ? "border-accent bg-accent-soft font-semibold text-accent-ink" : "border-line bg-surface"}`}
            >
              {c}
            </button>
          );
        })}
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Why? (optional, {MAX_NOTE - note.length} left)</span>
        <input
          value={note}
          maxLength={MAX_NOTE}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-11 rounded-r2 border border-line bg-surface px-3"
          placeholder="e.g. stop chasing gold"
        />
      </label>
      <PrimaryButton disabled={chip === null || relay.busy || saving} onClick={send}>
        Send correction
      </PrimaryButton>
      <ActionStatus phase={relay.phase} done="" onRecheck={relay.recheck} />
    </fieldset>
  );
}

/** #85 create: Challenges.create(myBot, season) → share link with the first 8 bytes of the code from the event. */
export function ChallengeButton({ ctx, botId }: { ctx: OwnerCtx; botId: string }) {
  const relay = useRelay(ctx.config, ctx.session);
  const [copied, setCopied] = useState(false);
  const event = relay.phase.name === "done" ? relay.phase.event : null;
  const link = event?.eventName === "ChallengeCreated" ? `${window.location.origin}/challenge/${shortCode(event.args.code)}` : null;
  const { Challenges, SeasonLedger } = ctx.config.targets;
  if (!Challenges || !SeasonLedger) return <NotLive>Challenges aren&apos;t switched on yet.</NotLive>;

  async function create() {
    let season: number;
    try {
      season = await createChainClient().readContract({ address: SeasonLedger!, abi: SEASON_LEDGER_ABI, functionName: "currentSeason" });
    } catch {
      relay.fail("Can't reach QIE right now. Nothing was sent. Please try again.");
      return;
    }
    await relay.run({ kind: "createChallenge", botId: BigInt(botId), season });
  }
  async function share() {
    if (!link) return;
    try {
      if (navigator.share) await navigator.share({ title: "BotFolio challenge", text: "My bot vs yours this season. Play money, no prizes.", url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
      }
    } catch {
      // closed the share sheet
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">Your bot vs a friend&apos;s, on this season&apos;s returns. No stakes, no prizes. Recognition only.</p>
      {link ? (
        <>
          <p className="break-all rounded-r2 bg-surface-2 p-3 font-mono text-sm">{link}</p>
          <PrimaryButton onClick={share}>{copied ? "Link copied" : "Share the link"}</PrimaryButton>
        </>
      ) : (
        <button type="button" className={ghost} disabled={relay.busy} onClick={create}>
          Challenge a friend
        </button>
      )}
      <ActionStatus phase={relay.phase} done="Challenge on QIE." onRecheck={relay.recheck} />
    </div>
  );
}
