/**
 * Website data shapes. They mirror SPEC.md §3 (Postgres) and §4 (contract events).
 * When WS B freezes packages/db/schema.sql and WS D freezes packages/shared/cards.ts,
 * replace these with imports from @botfolio/shared and delete the duplicates.
 */
import type { AssetId } from "@botfolio/shared";

/** How a data block should be labelled on the page. Never show EXAMPLE data as LIVE. */
export type DataStatus = "live" | "example" | "notlive" | "error";

export interface Loaded<T> {
  status: DataStatus;
  data: T | null;
  /** ISO time of the read, shown as "Updated hh:mm IST". */
  updatedAt: string | null;
  /** Where it came from, for the fallback link (explorer, API path). */
  source: string;
}

export interface OracleRead {
  asset: AssetId;
  roundId: string; // numeric string (uint80)
  answerE8: string; // 8-decimal fixed point
  updatedAt: string; // ISO
}

export interface Bot {
  id: number; // = on-chain botId
  ownerWallet: `0x${string}`;
  name: string;
  emoji: string;
  personaText?: string;
  isHouse: boolean;
  /** Display colour for the BotHead mascot. Derived client-side from id if absent. */
  color?: string;
  houseRule?: string;
  qieName?: string | null; // .qie reverse lookup — COMING (SPEC §0.6, UNVERIFIED)
}

export interface Trade {
  botId: number;
  asset: AssetId;
  side: "BUY" | "SELL";
  cashE8: string;
  priceE8: string;
  roundId: string;
  txHash: `0x${string}`;
  blockTime: string; // ISO
  /** true when executed via PaperLedger.executeApproved (owner-signed). */
  userSigned: boolean;
  /** ₹ display value: 100000 × cash / startCash (SPEC §3). */
  inrDisplay: number;
  /** Joined bot info for display (name, emoji). */
  bot?: Bot;
}

export interface BotVersion {
  version: number;
  rulesText: string;
  maxPerCoinBps: number;
  maxTradesPerDay: number;
  configHash: `0x${string}`;
  source: "create" | "season_v2";
  committedTx: `0x${string}` | null;
  approvedAt: string | null;
  /** v2 diff lines, e.g. { because: 'You said "too timid" 2×', what: "Max per coin", from: "30%", to: "35%" } */
  changes?: { because: string; what: string; from: string; to: string }[];
}

export interface TrustScore {
  rulesVersion: string; // trust-v1-sprint | trust-v1
  fRules: number;
  fDrawdown: number;
  fConsistency: number;
  fExplains: number;
  total: number;
  provisional: boolean;
}

export interface Decision {
  slotTime: string; // ISO
  status: "executed" | "held" | "skipped_stale" | "invalid";
  reason: string;
  reasonTag: string;
  roast?: string;
}

export interface Holding {
  asset: AssetId | "CASH"; weightPct: number; inrDisplay: number;
  /** Mark price (8 dp) and its age in minutes at the last slot — needed for the mandatory price-age label. */
  priceE8?: string; priceAgeMin?: number;
}

/** Payload of GET /api/v1/bots/:id/record (SPEC §10), as the site consumes it. */
export interface BotRecord {
  bot: Bot;
  valueInr: number;
  seasonReturnPct: number;
  holdings: Holding[];
  decisions: Decision[];
  trades: Trade[];
  versions: BotVersion[];
  trust: TrustScore;
  tradesCount: number;
}

export interface BoardRow {
  bot: Bot;
  returnPct: number;
  valueInr: number;
  trades: number;
  trust: number | null; // null = provisional ("new")
  sortino?: number;
}

export type BoardId = "returns" | "risk" | "trusted" | "coach";

export interface CoachRow { owner: `0x${string}`; bot: Bot; you: number; botScore: number }

export interface Leaderboards {
  season: number;
  returns: BoardRow[];
  risk: BoardRow[]; // empty during 2-day sprint seasons (needs ≥3 daily returns, SPEC §8)
  trusted: BoardRow[];
  coach: CoachRow[];
}

/** /stats split (SPEC §11). User-signed is counted by _msgSender. */
export interface ActivityStats {
  uniqueSigners: number;
  userSignedTxs: number;
  botsCreated: number;
  corrections: number;
  v2Approvals: number;
  approvedBigMoves: number;
  dailyCalls: number;
  challenges: number;
  system: { runnerBatches: number; dailyCallSettlements: number; seasonRoots: number };
}

export interface CardProof { label: string; txHash: `0x${string}`; whatItProves: string }
export interface CardPayload {
  id: string;
  kind: "trade" | "roast" | "battle" | "season" | "recap" | "evolution" | "challenge" | "call";
  bot: Bot;
  season: number;
  trust: number;
  headline: string; // plain text; the card renders emphasis itself
  line: string;
  proofs: CardProof[];
}

export interface ContractInfo { name: string; what: string; address: `0x${string}` | null }
