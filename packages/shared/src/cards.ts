/**
 * Share card payloads: what the worker writes to `cards.payload` and what the renderer and Verify-on-QIE panel read.
 * FROZEN INTERFACE (SPEC §12.2). Change only through one announced PR.
 *
 * Sources: SPEC §9 (kinds, content, sizes), §3 (cards table, ₹ rule), §5.7 (price age).
 * Rules for whoever fills or renders these:
 *  - Data only from indexed on-chain records + logged decision text. Nothing newly invented.
 *  - JSON-safe: uint values are decimal strings, times are ISO 8601. No bigint, no Date.
 *  - ₹ is never stored. displayINR = 100000 × valueE8 / startCashE8.
 *  - Names, emoji, lines and change text come from users or the LLM: untrusted plain text, always escape (#159).
 *  - Every txHash anywhere in a payload also appears in `cites`.
 */
import type { Address, Hex } from "viem";
import type { AssetId } from "./assets";

/** Same values, same order as the `card_kind` enum in packages/db/schema.sql. */
export const CARD_KINDS = ["trade", "roast", "battle", "season", "recap", "evolution", "challenge", "call"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** `og` is the default of /api/card/[cardId]; `story` is `?format=story` (WhatsApp status). */
export const CARD_SIZES = {
  og: { width: 1200, height: 630 },
  story: { width: 1080, height: 1920 },
} as const;
export type CardFormat = keyof typeof CARD_SIZES;

/** On every card (SPEC §9). */
export const CARD_FOOTER = "Settled against QIE's official mainnet oracle · play money · not advice";

/** An unsigned integer as a decimal string (uint256, uint80, botId). */
export type UintString = string;
/** A signed integer as a decimal string (value changes). */
export type IntString = string;

// ---------------------------------------------------------------------------------------------------
// Shared parts
// ---------------------------------------------------------------------------------------------------

export interface CardBot {
  botId: UintString;
  name: string;
  emoji: string;
  ownerAddress: Address;
  /** `name.qie`, or null: show a short address. */
  ownerQieName: string | null;
  /** Shows the "house" badge (§8). */
  isHouse: boolean;
}

/** A price as a contract or mark read it. `readAt − updatedAt` is the mandatory price-age label (§5.7). */
export interface CardOraclePrice {
  asset: AssetId;
  priceE8: UintString;
  roundId: UintString;
  /** Feed updatedAt. */
  updatedAt: string;
  /** Block or slot time of the read. Age is relative to this, because a card is cached for a year. */
  readAt: string;
}

/** The ₹ value on the card. */
export interface CardValue {
  valueE8: UintString;
  /** PaperLedger.START_CASH_E8: the startValue of the ₹ rule, not the value at season open. */
  startCashE8: UintString;
  markedAt: string;
  /** Oldest price behind the mark, for the age label. null = all cash. */
  oldestPrice: CardOraclePrice | null;
}

/** The % change on the card and what it is measured over. */
export interface CardChange {
  bps: number;
  deltaE8: IntString;
  since: "start" | "slot" | "day" | "season";
}

export interface CardTrustScore {
  /** 0..1000. */
  total: number;
  /** Shows the "new" badge. */
  provisional: boolean;
  rulesVersion: string;
}

/** The card's one line, copied from a logged decision. */
export interface CardLine {
  source: "reason" | "roast";
  decisionId: string;
  text: string;
}

export type CardCitationEvent =
  | "bot_created"
  | "trade"
  | "approved_trade"
  | "correction"
  | "version_committed"
  | "daily_call"
  | "daily_call_settled"
  | "challenge_created"
  | "challenge_accepted"
  | "challenge_settled"
  | "season_closed"
  | "scores_committed";

/** One row of the Verify-on-QIE panel. */
export interface CardCitation {
  event: CardCitationEvent;
  txHash: Hex;
  /** null when the tx reads no oracle. */
  oracle: { asset: AssetId; roundId: UintString } | null;
  /** One line, e.g. "This trade was priced by QIE's oracle round 50887, not by us". */
  proves: string;
}

/** A best or worst call: always an executed trade. */
export interface CardCallRef {
  decisionId: string;
  actionIndex: number;
  side: "BUY" | "SELL";
  price: CardOraclePrice;
  pnlBps: number;
  reason: string;
  txHash: Hex;
}

export interface CardPayloadBase<K extends CardKind> {
  schemaVersion: 1;
  /** Equals `cards.kind`. */
  kind: K;
  /** Equals `cards.id`. */
  cardId: string;
  createdAt: string;
  /** `bot.botId` equals `cards.bot_id`; the QR/short link is /bot/[botId]. */
  bot: CardBot;
  /** null between seasons (21:30 close to 00:00 open). */
  seasonId: number | null;
  value: CardValue;
  change: CardChange;
  /** null before the first score. */
  trust: CardTrustScore | null;
  line: CardLine | null;
  /** The first one is the short tx hash printed on the card. Can be empty only on a recap with no tx to cite. */
  cites: CardCitation[];
}

// ---------------------------------------------------------------------------------------------------
// The 8 kinds
// ---------------------------------------------------------------------------------------------------

/** First trade. */
export interface TradeCardPayload extends CardPayloadBase<"trade"> {
  line: CardLine;
  trade: {
    decisionId: string;
    actionIndex: number;
    side: "BUY" | "SELL";
    cashE8: UintString;
    unitsE18: UintString;
    price: CardOraclePrice;
    /** true = executeApproved, the owner's own signed tx. */
    approvedByOwner: boolean;
    txHash: Hex;
  };
}

/** A loss of 3 % or more in a slot, or the worst call of the season. */
export interface RoastCardPayload extends CardPayloadBase<"roast"> {
  line: CardLine;
  roast:
    | { trigger: "slot_loss"; slotTime: string; lossBps: number; lossE8: UintString }
    | { trigger: "worst_call"; lossBps: number; lossE8: UintString; call: CardCallRef };
}

export interface CardBattleEntry {
  bot: CardBot;
  rank: 1 | 2 | 3 | 4;
  returnBps: number;
}

/** Season rank against the 3 house bots. */
export interface BattleCardPayload extends CardPayloadBase<"battle"> {
  seasonId: number;
  battle: {
    rank: 1 | 2 | 3 | 4;
    /** This bot and the 3 house bots, in rank order. */
    entries: [CardBattleEntry, CardBattleEntry, CardBattleEntry, CardBattleEntry];
  };
}

export interface SeasonCardPayload extends CardPayloadBase<"season"> {
  seasonId: number;
  season: {
    returnBps: number;
    maxDdBps: number;
    trades: number;
    best: CardCallRef | null;
    worst: CardCallRef | null;
  };
}

/** Daily, 21:35 IST. Made on quiet days too. */
export interface RecapCardPayload extends CardPayloadBase<"recap"> {
  recap: {
    /** IST day number, as in the contracts. */
    day: number;
    best: CardCallRef | null;
    worst: CardCallRef | null;
    /** null when the bot has no rank yet. */
    rank: { position: number; of: number } | null;
  };
}

/** Why a v2 change was made (§2.3): the coach's corrections, or the results if there were none. */
export type CardChangeReason =
  | { source: "corrections"; chip: string; count: number }
  | { source: "season_result"; text: string };

export type CardVersionChange =
  | { setting: "max_per_coin_bps"; from: number; to: number; because: CardChangeReason }
  | { setting: "max_trades_per_day"; from: number; to: number; because: CardChangeReason }
  | { setting: "rules"; what: string; because: CardChangeReason };

/** The v2 diff: "You said 'too risky' 3× → 40 % → 25 %". */
export interface EvolutionCardPayload extends CardPayloadBase<"evolution"> {
  evolution: {
    fromVersion: number;
    toVersion: number;
    configHash: Hex;
    /** At most 5 (§6.3). */
    changes: CardVersionChange[];
    txHash: Hex;
  };
}

export interface CardChallengeSide {
  bot: CardBot;
  returnBps: number;
  maxDdBps: number;
}

/** Bot vs bot result. Rematch is a button built from the two bot ids. */
export interface ChallengeCardPayload extends CardPayloadBase<"challenge"> {
  seasonId: number;
  challenge: {
    /** Full bytes32 code; share links use its first 8 bytes. */
    code: Hex;
    challenger: CardChallengeSide;
    opponent: CardChallengeSide;
    /** One of the two bots, as Challenges.settle requires. */
    winnerBotId: UintString;
    txHash: Hex;
  };
}

/** Daily Call result: "You 4 – AlphaWolf 3". Only made after settlement, so it can show the bot's answer. */
export interface CallCardPayload extends CardPayloadBase<"call"> {
  call: {
    /** IST day number. */
    day: number;
    userUp: boolean;
    botUp: boolean;
    /** Both false also covers an equal price (no winner). */
    userCorrect: boolean;
    botCorrect: boolean;
    priceAtCall: CardOraclePrice;
    settlePrice: CardOraclePrice;
    score: { user: number; bot: number };
    streak: number;
    callTxHash: Hex;
    settleTxHash: Hex;
  };
}

export type CardPayload =
  | TradeCardPayload
  | RoastCardPayload
  | BattleCardPayload
  | SeasonCardPayload
  | RecapCardPayload
  | EvolutionCardPayload
  | ChallengeCardPayload
  | CallCardPayload;

/** The payload for one kind, e.g. `CardPayloadOf<"roast">`. */
export type CardPayloadOf<K extends CardKind> = Extract<CardPayload, { kind: K }>;
