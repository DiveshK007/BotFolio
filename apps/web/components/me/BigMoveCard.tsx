"use client";

import { approvedOrderFromJson } from "@botfolio/shared";
import { useState } from "react";
import { zeroHash } from "viem";
import { ErrorNote, PrimaryButton } from "@/components/create/controls";
import { userMessage } from "@/lib/errors";
import { assetName } from "@/lib/format";
import { countdown, shrinkBigMove, type PendingBigMove } from "@/lib/owner";
import { BLOCKED_CHIP } from "@/lib/relay-call";
import type { OwnerCtx } from "./OwnerActions";
import { ActionStatus, useRelay } from "./relay-ui";

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;

/** SPEC §2.2 wording, from the order itself: a BUY's bps is a share of cash, a SELL's a share of the holding. */
export function bigMoveLine(m: Pick<PendingBigMove, "botName" | "side" | "bps" | "asset">): string {
  return m.side === "BUY"
    ? `${m.botName} wants to put ${pct(m.bps)} of its cash into ${assetName(m.asset)}. Allow?`
    : `${m.botName} wants to sell ${pct(m.bps)} of its ${assetName(m.asset)}. Allow?`;
}

/**
 * #80 Approve Big Move. Allow = the owner signs PaperLedger.executeApproved with the runner-signed order, so the
 * user's own tx is the trade, priced on-chain by the oracle. Shrink = no tx: the runner sends the safe size within
 * 10 min. Block = a "blocked" correction on that decision, which also stops the safe-size fallback.
 */
export function BigMoveCard({ ctx, move, now }: { ctx: OwnerCtx; move: PendingBigMove; now: number }) {
  const relay = useRelay(ctx.config, ctx.session);
  const [choice, setChoice] = useState<"allow" | "block" | null>(null);
  const [shrunk, setShrunk] = useState<{ busy: boolean; note?: string; error?: string } | null>(null);
  const left = Date.parse(move.deadline) - now;
  const order = approvedOrderFromJson(move.signed.order);
  const decided = relay.phase.name === "done" || Boolean(shrunk?.note);
  const busy = relay.busy || Boolean(shrunk?.busy);

  async function allow() {
    setChoice("allow");
    await relay.run({ kind: "executeApproved", order, runnerSig: move.signed.runnerSig });
  }
  async function block() {
    setChoice("block");
    await relay.run({ kind: "recordCorrection", botId: order.botId, decisionId: order.decisionId, noteHash: zeroHash, chip: BLOCKED_CHIP });
  }
  async function shrink() {
    setShrunk({ busy: true });
    try {
      setShrunk({ busy: false, note: await shrinkBigMove(ctx.config.workerUrl, ctx.session, move.orderId) });
    } catch (e) {
      setShrunk({ busy: false, error: userMessage(e) });
    }
  }

  return (
    <section aria-label="Big move waiting for you" className="flex flex-col gap-3 rounded-r3 border-2 border-sun bg-sun-soft p-4">
      <h2 className="font-display text-xl font-extrabold [overflow-wrap:anywhere]">
        <bdi>{bigMoveLine(move)}</bdi>
      </h2>
      {move.reason && (
        <p className="text-sm [overflow-wrap:anywhere]">
          <bdi>{move.reason}</bdi>
        </p>
      )}
      {!decided && (
        <p className="text-xs text-muted">
          {left > 0 ? `Decide within ${countdown(left)}. After that your bot sends a safe size instead.` : "Time's up: your bot sends a safe size instead."}
        </p>
      )}
      {!decided && left > 0 && (
        <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-3">
          <PrimaryButton disabled={busy || !ctx.config.targets.PaperLedger} onClick={allow}>
            Allow
          </PrimaryButton>
          <button type="button" disabled={busy} onClick={shrink} className="min-h-12 rounded-full border border-line bg-surface px-3 text-sm font-semibold disabled:opacity-60">
            Shrink to safe size
          </button>
          <button type="button" disabled={busy || !ctx.config.targets.SeasonLedger} onClick={block} className="min-h-12 rounded-full border border-down px-3 text-sm font-semibold text-down disabled:opacity-60">
            Block
          </button>
        </div>
      )}
      <ActionStatus
        phase={relay.phase}
        done={choice === "allow" ? "Your signed trade is on QIE, priced by QIE's official mainnet oracle." : "Blocked. Your bot won't make this move."}
        onRecheck={relay.recheck}
      />
      {shrunk?.busy && <p role="status" className="text-sm text-muted">Asking for the safe size…</p>}
      {shrunk?.note && <p role="status" className="text-sm">{shrunk.note}</p>}
      {shrunk?.error && <ErrorNote>{shrunk.error}</ErrorNote>}
    </section>
  );
}
