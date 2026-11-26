"use client";

import { ASSETS, type AssetId } from "@botfolio/shared";
import { useEffect, useState } from "react";
import { parseAbi } from "viem";
import { OraclePrice } from "@/components/ui/OraclePrice";
import { callLabel, type BotPage } from "@/lib/bot-record";
import { countdown, nextSlot } from "@/lib/owner";
import { createChainClient } from "@/lib/relay-call";

const FEED_ABI = parseAbi(["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)"]);

/** The asset the bot is most exposed to, else BTC (the Daily Call asset). */
export function watching(page: Pick<BotPage, "mark">): AssetId {
  const top = [...(page.mark?.holdings ?? [])].sort((a, b) => (BigInt(b.value_e8) > BigInt(a.value_e8) ? 1 : -1))[0];
  return top?.asset ?? "BTC";
}

type Live = { answerE8: bigint; roundId: bigint; updatedAt: number } | null;

/**
 * #77 thinking feed (SPEC §2.2): between slots, the latest one-liner and a countdown to the next call. No extra LLM
 * call: the last decision's text plus one live read of the watched feed on QIE.
 */
export function ThinkingFeed({ page, now }: { page: BotPage; now: number }) {
  const asset = watching(page);
  const [live, setLive] = useState<Live | "failed">(null);
  useEffect(() => {
    let on = true;
    const feed = ASSETS.find((a) => a.id === asset)!.feed;
    createChainClient()
      .readContract({ address: feed, abi: FEED_ABI, functionName: "latestRoundData" })
      .then(([roundId, answer, , updatedAt]) => on && setLive({ answerE8: answer, roundId, updatedAt: Number(updatedAt) }))
      .catch(() => on && setLive("failed"));
    return () => {
      on = false;
    };
  }, [asset]);

  const last = page.decisions[0];
  const paused = page.bot.status !== "active";
  return (
    <section aria-labelledby="thinking" className="flex flex-col gap-2 rounded-r3 border border-line bg-surface p-4 shadow-card">
      <h2 id="thinking" className="font-display text-xl font-extrabold">
        What <bdi>{page.bot.name}</bdi> is thinking
      </h2>
      {last ? (
        <>
          <p className="[overflow-wrap:anywhere]">{last.reason ? <bdi>{last.reason}</bdi> : <span className="text-muted">{callLabel(last.status)} at its last call.</span>}</p>
          {last.roast && (
            <p className="text-sm italic text-muted [overflow-wrap:anywhere]">
              <bdi>{last.roast}</bdi>
            </p>
          )}
        </>
      ) : (
        <p className="text-muted">No calls yet. Its first one is on the way.</p>
      )}
      <p className="text-sm font-semibold">
        {paused ? "Paused: no calls until you resume." : `Next call in ${countdown(nextSlot(now).getTime() - now)} · watching ${asset === "GOLD" ? "Gold" : asset}`}
      </p>
      {live && live !== "failed" && (
        <p className="text-sm">
          <OraclePrice asset={asset} answerE8={live.answerE8} roundId={live.roundId} updatedAt={live.updatedAt} />
        </p>
      )}
      {live === "failed" && <p className="text-xs text-muted">Couldn&apos;t read the live {asset === "GOLD" ? "Gold" : asset} price from QIE just now.</p>}
    </section>
  );
}
