"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isAddressEqual } from "viem";
import { PrimaryButton } from "@/components/create/controls";
import { ActionStatus, NotLive, SignInCard, useRelay } from "@/components/me/relay-ui";
import { getOwnerConfig } from "@/lib/config";
import { REGISTRY_ABI } from "@/lib/create-bot";
import type { PublicChallenge } from "@/lib/owner";
import { createChainClient } from "@/lib/relay-call";
import { useOwnerSession } from "@/lib/use-owner-session";

type Mine = { kind: "loading" } | { kind: "failed" } | { kind: "ok"; botId: bigint };

/** #85 accept: the friend signs Challenges.accept(fullCode, theirBot). The full code came from the worker. */
export function ChallengeAccept({ challenge }: { challenge: PublicChallenge }) {
  const [config] = useState(getOwnerConfig);
  const { available, session, busy, error, signIn } = useOwnerSession();
  const relay = useRelay(config, session);
  const [mine, setMine] = useState<Mine>({ kind: "loading" });
  const registry = config?.targets.BotRegistry;

  useEffect(() => {
    if (!session || !registry) return;
    let on = true;
    createChainClient()
      .readContract({ address: registry, abi: REGISTRY_ABI, functionName: "botOf", args: [session.address] })
      .then((botId) => on && setMine({ kind: "ok", botId }), () => on && setMine({ kind: "failed" }));
    return () => {
      on = false;
    };
  }, [session, registry]);

  if (!config || !registry || !config.targets.Challenges) return <NotLive>Accepting challenges isn&apos;t switched on yet.</NotLive>;
  if (!session) {
    return (
      <div className="flex flex-col gap-3">
        <Link href="/" className="inline-flex h-12 items-center justify-center rounded-full bg-accent px-6 font-semibold text-on-accent">
          Make a bot in 30 seconds
        </Link>
        <p className="text-center text-xs text-muted">Then open this link again to accept.</p>
        <SignInCard available={available} busy={busy} error={error} onSignIn={signIn} why="Already have a bot? Sign in to accept with it." />
      </div>
    );
  }
  if (mine.kind === "loading") return <p role="status" className="text-sm text-muted">Finding your bot on QIE…</p>;
  if (mine.kind === "failed") return <NotLive>Can&apos;t reach QIE right now. Reload the page in a minute.</NotLive>;
  if (mine.botId === 0n) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm">This wallet has no bot yet.</p>
        <Link href="/" className="inline-flex h-12 items-center justify-center rounded-full bg-accent px-6 font-semibold text-on-accent">
          Make a bot in 30 seconds
        </Link>
        <p className="text-center text-xs text-muted">Then open this link again to accept.</p>
      </div>
    );
  }
  if (isAddressEqual(session.address, challenge.challenger.ownerWallet as `0x${string}`)) {
    return <p className="text-sm text-muted">This is your own challenge. Share the link with a friend.</p>;
  }
  const accept = () => relay.run({ kind: "acceptChallenge", code: challenge.code, botId: mine.botId });
  return (
    <div className="flex flex-col gap-2">
      {relay.phase.name !== "done" && (
        <PrimaryButton disabled={relay.busy} onClick={accept}>
          Accept with my bot #{mine.botId.toString()}
        </PrimaryButton>
      )}
      <ActionStatus phase={relay.phase} done={`Accepted. Result at the season ${challenge.season} close.`} onRecheck={relay.recheck} />
    </div>
  );
}
