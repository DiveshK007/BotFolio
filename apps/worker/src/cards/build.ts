import {
  ASSETS,
  type AssetId,
  type CardBot,
  type CardCallRef,
  type CardCitation,
  type CardOraclePrice,
  type CardPayload,
  type CardTrustScore,
  type CardValue,
} from "@botfolio/shared";
import { parseAbi, type Address, type Hex, type PublicClient } from "viem";
import type { Queryable } from "../scheduler/db";

/*
 * Parts every card payload shares (packages/shared/src/cards.ts, SPEC §9). Only indexed on-chain records and
 * logged decision text go in; times and rounds we didn't record are read from QIE, never guessed.
 */

export interface CardChain {
  startCashE8(): Promise<bigint>;
  blockTime(block: bigint): Promise<Date>;
  /** The feed's `updatedAt` for a round. */
  roundUpdatedAt(asset: AssetId, roundId: bigint): Promise<Date>;
  /** When a tx was mined. */
  txTime(hash: Hex): Promise<Date>;
  /** The `ChallengeSettled` tx for a code, searched forward from `afterTx` (the season close). null until found. */
  challengeSettledTx(code: Hex, afterTx: Hex): Promise<Hex | null>;
}

const FEED = parseAbi(["function getRoundData(uint80 roundId) view returns (uint80, int256, uint256, uint256, uint80)"]);
const SETTLED = parseAbi(["event ChallengeSettled(bytes32 indexed code, uint256 indexed winnerBot)"])[0];
/** QIE RPCs answer getLogs for ranges this big (as the replay verifier uses); settle runs right after the close. */
const LOG_RANGE = 2000n;
const SETTLE_SEARCH_BLOCKS = 20_000n;

export function createCardChain(client: PublicClient, startCashE8: () => Promise<bigint>, challenges: Address | null = null): CardChain {
  const blocks = new Map<bigint, Promise<Date>>();
  const txs = new Map<string, Promise<Date>>();
  const rounds = new Map<string, Promise<Date>>();
  const remember = <K>(cache: Map<K, Promise<Date>>, key: K, load: () => Promise<Date>) => {
    let hit = cache.get(key);
    if (!hit) {
      hit = load();
      hit.catch(() => cache.delete(key));
      if (cache.size > 5000) cache.clear();
      cache.set(key, hit);
    }
    return hit;
  };
  const blockTime = (block: bigint) =>
    remember(blocks, block, async () => new Date(Number((await client.getBlock({ blockNumber: block })).timestamp) * 1000));
  return {
    startCashE8,
    blockTime,
    txTime: (hash) => remember(txs, hash, async () => blockTime((await client.getTransactionReceipt({ hash })).blockNumber)),
    async challengeSettledTx(code, afterTx) {
      if (!challenges) return null;
      const from = (await client.getTransactionReceipt({ hash: afterTx })).blockNumber;
      const latest = await client.getBlockNumber();
      for (let start = from; start <= latest && start < from + SETTLE_SEARCH_BLOCKS; start += LOG_RANGE) {
        const toBlock = start + LOG_RANGE - 1n < latest ? start + LOG_RANGE - 1n : latest;
        const logs = await client.getLogs({ address: challenges, event: SETTLED, args: { code }, fromBlock: start, toBlock });
        if (logs[0]) return logs[0].transactionHash;
      }
      return null;
    },
    roundUpdatedAt: (asset, roundId) =>
      remember(rounds, `${asset}:${roundId}`, async () => {
        const feed = ASSETS.find((a) => a.id === asset)!.feed;
        const [, , , updatedAt] = await client.readContract({ address: feed, abi: FEED, functionName: "getRoundData", args: [roundId] });
        return new Date(Number(updatedAt) * 1000);
      }),
  };
}

export async function cardBot(db: Queryable, botId: string): Promise<CardBot | null> {
  const { rows } = await db.query<{ id: string; name: string; emoji: string; owner: Address; qie: string | null; is_house: boolean }>(
    `select b.id::text as id, b.name, b.emoji, b.owner_wallet as owner, q.qie_name as qie, b.is_house
     from bots b left join qie_names q on q.wallet_address = b.owner_wallet where b.id = $1::bigint`,
    [botId],
  );
  const b = rows[0];
  return b ? { botId: b.id, name: b.name, emoji: b.emoji, ownerAddress: b.owner, ownerQieName: b.qie, isHouse: b.is_house } : null;
}

export async function cardTrust(db: Queryable, botId: string): Promise<CardTrustScore | null> {
  const { rows } = await db.query<{ total: number; provisional: boolean; rules: string }>(
    "select total, provisional, rules_version as rules from trust_scores where bot_id = $1::bigint and season_id > 0 order by season_id desc limit 1", // S0 is hidden (#219)
    [botId],
  );
  const t = rows[0];
  return t ? { total: t.total, provisional: t.provisional, rulesVersion: t.rules } : null;
}

/** The public season open at `at`, or null between a 21:30 close and the next 00:00 open, and during the hidden S0 (#219). */
export async function seasonAt(db: Queryable, at: Date): Promise<number | null> {
  const { rows } = await db.query<{ id: number }>(
    "select id from seasons where id > 0 and starts_at <= $1::timestamptz and ends_at > $1::timestamptz order by id desc limit 1",
    [at.toISOString()],
  );
  return rows[0]?.id ?? null;
}

export interface Mark {
  slotId: string;
  slotTime: Date;
  valueE8: bigint;
  held: AssetId[];
}

export async function markOf(db: Queryable, botId: string, slotId: string): Promise<Mark | null> {
  const { rows } = await db.query<{ slot_time: Date; value_e8: string; holdings: Record<string, unknown> }>(
    `select s.slot_time, m.value_e8::text as value_e8, m.holdings
     from portfolio_marks m join slots s on s.id = m.slot_id where m.bot_id = $1::bigint and m.slot_id = $2::bigint`,
    [botId, slotId],
  );
  const m = rows[0];
  return m ? { slotId, slotTime: new Date(m.slot_time), valueE8: BigInt(m.value_e8), held: Object.keys(m.holdings ?? {}) as AssetId[] } : null;
}

/** The $ value of a mark, with the oldest price behind it for the age label (null = all cash). */
export async function cardValue(db: Queryable, chain: CardChain, mark: Mark): Promise<CardValue> {
  let oldestPrice: CardOraclePrice | null = null;
  if (mark.held.length > 0) {
    const { rows } = await db.query<{ asset: AssetId; answer: string; round_id: string; updated_at: Date }>(
      `select asset::text as asset, answer::text as answer, round_id::text as round_id, updated_at from oracle_reads
       where slot_id = $1::bigint and asset::text = any($2::text[]) order by updated_at asc limit 1`,
      [mark.slotId, mark.held],
    );
    const r = rows[0];
    if (r) {
      oldestPrice = {
        asset: r.asset,
        priceE8: r.answer,
        roundId: r.round_id,
        updatedAt: new Date(r.updated_at).toISOString(),
        readAt: mark.slotTime.toISOString(),
      };
    }
  }
  return {
    valueE8: mark.valueE8.toString(),
    startCashE8: (await chain.startCashE8()).toString(),
    markedAt: mark.slotTime.toISOString(),
    oldestPrice,
  };
}

export const changeBps = (from: bigint, to: bigint) => (from > 0n ? Number(((to - from) * 10_000n) / from) : 0);

export interface TradeRow {
  decision_id: string;
  action_index: number;
  asset: AssetId;
  side: "BUY" | "SELL";
  cash_e8: string;
  units_e18: string;
  price_e8: string;
  round_id: string;
  tx_hash: Hex;
  block_number: string;
  reason: string | null;
  approved: boolean;
}

/** Indexed trades, with whether the owner's own `executeApproved` sent them (an allowed big move). */
export const TRADE_COLUMNS = `t.decision_id::text as decision_id, t.action_index, t.asset::text as asset, t.side::text as side,
  t.cash_e8::text as cash_e8, t.units_e18::text as units_e18, t.price_e8::text as price_e8, t.round_id::text as round_id,
  t.tx_hash, t.block_number::text as block_number, d.reason,
  exists (select 1 from big_moves bm where bm.order_id = t.order_id and bm.user_tx = t.tx_hash) as approved`;

/** The price a trade settled at, as the contract read it in its block. */
export async function tradePrice(db: Queryable, chain: CardChain, t: TradeRow): Promise<CardOraclePrice> {
  const { rows } = await db.query<{ updated_at: Date }>(
    "select updated_at from oracle_reads where asset::text = $1::text and round_id = $2::numeric limit 1",
    [t.asset, t.round_id],
  );
  const updatedAt = rows[0] ? new Date(rows[0].updated_at) : await chain.roundUpdatedAt(t.asset, BigInt(t.round_id));
  return {
    asset: t.asset,
    priceE8: t.price_e8,
    roundId: t.round_id,
    updatedAt: updatedAt.toISOString(),
    readAt: (await chain.blockTime(BigInt(t.block_number))).toISOString(),
  };
}

export function tradeCitation(t: TradeRow): CardCitation {
  return {
    event: t.approved ? "approved_trade" : "trade",
    txHash: t.tx_hash,
    oracle: { asset: t.asset, roundId: t.round_id },
    proves: t.approved
      ? `The owner allowed this trade; QIE's oracle round ${t.round_id} priced it, not us`
      : `This trade was priced by QIE's oracle round ${t.round_id}, not by us`,
  };
}

/**
 * A trade as a best or worst call: its P&L from its price to `markPrices` (the card's mark). A SELL gains when the
 * price then falls. The window (trade → the card's mark) is our default until #219 settles it.
 */
export async function callRef(db: Queryable, chain: CardChain, t: TradeRow, markPrices: Partial<Record<AssetId, bigint>>): Promise<CardCallRef | null> {
  const now = markPrices[t.asset];
  const then = BigInt(t.price_e8);
  if (now === undefined || then === 0n) return null;
  const move = Number(((now - then) * 10_000n) / then);
  return {
    decisionId: t.decision_id,
    actionIndex: t.action_index,
    side: t.side,
    price: await tradePrice(db, chain, t),
    pnlBps: t.side === "BUY" ? move : -move,
    reason: t.reason ?? "",
    txHash: t.tx_hash,
  };
}

export async function slotPrices(db: Queryable, slotId: string): Promise<Partial<Record<AssetId, bigint>>> {
  const { rows } = await db.query<{ asset: AssetId; answer: string }>(
    "select asset::text as asset, answer::text as answer from oracle_reads where slot_id = $1::bigint",
    [slotId],
  );
  return Object.fromEntries(rows.map((r) => [r.asset, BigInt(r.answer)]));
}

/** Writes a card once: its id is derived from what it is about, so a rerun is a no-op. */
export async function saveCard(db: Queryable, card: CardPayload): Promise<boolean> {
  const txs = new Set(card.cites.map((c) => c.txHash));
  for (const tx of collectTxHashes(card)) {
    if (!txs.has(tx)) throw new Error(`card ${card.cardId} shows ${tx} without citing it`);
  }
  const { rows } = await db.query(
    `insert into cards (id, bot_id, kind, payload, created_at) values ($1::text, $2::bigint, $3::card_kind, $4::jsonb, $5::timestamptz)
     on conflict (id) do nothing returning id`,
    [card.cardId, card.bot.botId, card.kind, JSON.stringify(card), card.createdAt],
  );
  return rows.length > 0;
}

/** Every value under a `txHash` key, or under keys ending in TxHash. "Every txHash anywhere in a payload also appears in cites." */
function collectTxHashes(value: unknown, key = ""): Hex[] {
  if (typeof value === "string") return /txhash$/i.test(key) && /^0x[0-9a-f]{64}$/i.test(value) ? [value as Hex] : [];
  if (Array.isArray(value)) return value.flatMap((v) => collectTxHashes(v));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => (k === "cites" ? [] : collectTxHashes(v, k)));
}
