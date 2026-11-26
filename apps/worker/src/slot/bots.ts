import type { AssetId } from "@botfolio/shared";
import { InternalFailure } from "../auth/log";
import { owedRebalance, staleRebalanceAssets, type HouseStrategy } from "../house/strategies";
import type { Queryable } from "../scheduler/db";
import type { Slot } from "../scheduler/slots";
import type { ChainBot } from "./chain";
import { staleIndexes, type StoredDecision } from "./stored";

export interface BotProfile {
  name: string;
  persona: string;
  rules: string;
  /** The `bot_versions` row the decision points at. */
  version: number;
}

/**
 * Who the bot is, for the prompt. A version committed a moment ago may not be indexed yet, so it's the newest
 * row we have up to the chain's version. Limits always come from the chain.
 */
export async function botProfile(db: Queryable, botId: bigint, chain: ChainBot): Promise<BotProfile> {
  const { rows } = await db.query<BotProfile>(
    `select b.name, b.persona_text as persona, v.rules_text as rules, v.version
     from bots b join bot_versions v on v.bot_id = b.id
     where b.id = $1::bigint and v.version <= $2::int and (v.committed_tx is not null or v.source = 'create')
     order by v.version desc limit 1`,
    [botId.toString(), chain.version],
  );
  if (!rows[0]) throw new InternalFailure("bot_row_missing");
  return rows[0];
}

const HOUSE: Readonly<Record<string, HouseStrategy>> = {
  "Steady Sam": "steady_sam",
  "Gold Granny": "gold_granny",
  "Momentum Max": "momentum_max",
};

/** House bots are told apart by their SPEC §8 names, which the seed writes (#134). */
export function houseStrategy(name: string): HouseStrategy {
  if (!Object.hasOwn(HOUSE, name)) throw new InternalFailure("unknown_house_bot");
  return HOUSE[name]!;
}

/**
 * `HouseContext.pendingRebalance` for a scheduled slot (#219 item 19): the assets the bot's previous decision in
 * the same season meant to rebalance but couldn't, because their price was still too old after the +15 min retry.
 * A retry slot only targets those assets, so following the chain one decision back is enough. If the bot has no
 * decision since the season's first 09:00 slot (that slot was missed), it is the whole rebalance (`owedRebalance`).
 */
export async function pendingRebalanceOf(db: Queryable, botId: bigint, slot: Slot, strategy: HouseStrategy): Promise<AssetId[]> {
  if (slot.kind !== "scheduled" || !slot.season) return [];
  const { rows } = await db.query<{ id: string; time: Date; raw: unknown; input: unknown; gate_result: unknown }>(
    `select d.id::text as id, s.slot_time as time, d.raw_output_json as raw, d.input_json as input, d.gate_result
     from decisions d join slots s on s.id = d.slot_id
     where d.bot_id = $1::bigint and s.season_id = $2::int and s.kind = 'scheduled' and s.slot_time < $3::timestamptz
     order by s.slot_time desc limit 1`,
    [botId.toString(), slot.season.id, slot.time.toISOString()],
  );
  const row = rows[0];
  const owed = owedRebalance(strategy, slot, slot.season.startsAt, row ? new Date(row.time) : null);
  if (owed.length > 0 || !row?.raw) return owed;
  const input = row.input as { strategy: HouseStrategy; slot: { kind: Slot["kind"]; time: string }; seasonStart: string | null; pendingRebalance?: AssetId[] };
  const actions = (row.raw as { actions: { asset: AssetId }[] }).actions;
  const decision: StoredDecision = { id: row.id, botId, raw: row.raw, input: row.input, gateResult: (row.gate_result ?? {}) as StoredDecision["gateResult"] };
  return staleRebalanceAssets(
    {
      strategy: input.strategy,
      slot: { kind: input.slot.kind, time: new Date(input.slot.time) },
      seasonStart: input.seasonStart ? new Date(input.seasonStart) : null,
      pendingRebalance: input.pendingRebalance,
    },
    staleIndexes(decision).map((i) => actions[i]!.asset),
  );
}

/** Average entry price of what is held, from the indexed trades. A sell doesn't move it. */
export async function averageEntries(db: Queryable, botId: bigint): Promise<Partial<Record<AssetId, bigint>>> {
  const { rows } = await db.query<{ asset: AssetId; side: "BUY" | "SELL"; cash: string; units: string }>(
    `select asset::text as asset, side::text as side, cash_e8::text as cash, units_e18::text as units
     from trades where bot_id = $1::bigint and tx_hash is not null
     order by block_number, log_index`,
    [botId.toString()],
  );
  const held = new Map<AssetId, { units: bigint; cost: bigint }>();
  for (const row of rows) {
    const at = held.get(row.asset) ?? { units: 0n, cost: 0n };
    const units = BigInt(row.units);
    if (row.side === "BUY") {
      at.units += units;
      at.cost += BigInt(row.cash);
    } else if (at.units > 0n) {
      const left = at.units > units ? at.units - units : 0n;
      at.cost = (at.cost * left) / at.units;
      at.units = left;
    }
    held.set(row.asset, at);
  }
  const entries: Partial<Record<AssetId, bigint>> = {};
  for (const [asset, { units, cost }] of held) if (units > 0n) entries[asset] = (cost * 10n ** 18n) / units;
  return entries;
}

const RECENT_CORRECTIONS = 5;

/** SPEC §6.2 `recent_corrections`: the owner's latest ones that are on-chain. */
export async function recentCorrections(db: Queryable, botId: bigint): Promise<{ chip: string; note: string | null }[]> {
  const { rows } = await db.query<{ chip: string; note: string | null }>(
    `select chip, note from corrections
     where bot_id = $1::bigint and tx_hash is not null
     order by created_at desc, id desc limit $2::int`,
    [botId.toString(), RECENT_CORRECTIONS],
  );
  return rows;
}
