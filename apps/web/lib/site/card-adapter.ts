/**
 * The worker writes the shared CardPayload (packages/shared cards.ts) to `cards.payload`; the /card page draws the
 * site's own CardPayload (lib/site/types.ts). This maps one onto the other so a real card renders and verifies.
 */
import { CARD_KINDS, type CardBot, type CardCitationEvent, type CardPayload as StoredCard } from "@botfolio/shared";
import { isRenderedCard, kindParts } from "@/app/api/card/render";
import { displayMoney, formatMoney } from "@/lib/format";
import { pct } from "./format";
import type { Bot, CardPayload } from "./types";

const LABELS: Record<CardCitationEvent, string> = {
  bot_created: "Bot created",
  trade: "Trade tx",
  approved_trade: "Owner-approved trade",
  correction: "Correction",
  version_committed: "Version commit",
  daily_call: "Daily call",
  daily_call_settled: "Call settled",
  challenge_created: "Challenge created",
  challenge_accepted: "Challenge accepted",
  challenge_settled: "Challenge settled",
  season_closed: "Season close",
  scores_committed: "Trust scores",
};

/** `cards.payload` is read from the database: check the parts the page touches before trusting the shape. */
export function isStoredCard(x: unknown): x is StoredCard {
  const c = x as Partial<StoredCard> | null;
  return !!c && typeof c === "object" && c.schemaVersion === 1 && (CARD_KINDS as readonly string[]).includes(c.kind as string)
    && typeof c.cardId === "string" && !!c.bot && typeof c.bot.name === "string" && Array.isArray(c.cites)
    && !!c.value && typeof c.value.startCashE8 === "string";
}

const toBot = (b: CardBot): Bot => ({ id: Number(b.botId), ownerWallet: b.ownerAddress, name: b.name, emoji: b.emoji, isHouse: b.isHouse, qieName: b.ownerQieName });

function headline(c: StoredCard): string {
  const money = (e8: string) => formatMoney(displayMoney(BigInt(e8), BigInt(c.value.startCashE8)));
  if (isRenderedCard(c)) return kindParts(c, money).headline; // same words as the PNG
  switch (c.kind) {
    case "battle": return `Rank ${c.battle.rank} of 4 against the house bots in Season ${c.seasonId}`;
    case "season": return `Season ${c.seasonId}: ${pct(c.season.returnBps / 100)} over ${c.season.trades} trades`;
    case "evolution": return `v${c.evolution.fromVersion} → v${c.evolution.toVersion}`;
    case "challenge": {
      const { challenger: a, opponent: b, winnerBotId } = c.challenge;
      const winner = winnerBotId === a.bot.botId ? a : b;
      return `${a.bot.name} vs ${b.bot.name}: ${winner.bot.name} wins, ${pct(winner.returnBps / 100)}`;
    }
    case "call": return `You ${c.call.score.user} – ${c.bot.name} ${c.call.score.bot}`;
  }
}

export function toSiteCard(c: StoredCard): CardPayload {
  const opponent = c.kind === "challenge" ? (c.challenge.challenger.bot.botId === c.bot.botId ? c.challenge.opponent : c.challenge.challenger).bot : undefined;
  return {
    id: c.cardId,
    kind: c.kind,
    bot: toBot(c.bot),
    season: c.seasonId,
    trust: c.trust?.total ?? null,
    headline: headline(c),
    line: c.line?.text ?? "",
    proofs: c.cites.map(x => ({ label: LABELS[x.event] ?? x.event, txHash: x.txHash, whatItProves: x.proves, oracle: x.oracle })),
    ...(opponent && { opponent: toBot(opponent) }),
  };
}
