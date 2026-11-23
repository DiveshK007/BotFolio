import type { Address, Hex } from "viem";
import { canonicalJson, hashText } from "../canonical";
import { readExact } from "../decisions/json";
import type { Queryable } from "../scheduler/db";
import { merkleRoot } from "./merkle";

/** Written into the file, so a replay knows where to check it. */
export interface ReplayContracts {
  chainId: number;
  seasonLedger: Address;
  paperLedger: Address;
  /** The deploy block: where the replay starts reading Trade events. */
  fromBlock: string;
}

export interface ReplayFile {
  lines: string[];
  /** keccak256 of each line's text (SPEC §6.5). */
  leaves: Hex[];
  root: Hex;
  /** `season-<n>.jsonl`. */
  text: string;
}

const hex = (value: unknown) => (value === null || value === undefined ? null : `0x${String(value)}`);

/**
 * The season's replay file (SPEC §6.5): canonical JSON with sorted keys, one line each for the season, every
 * decision (with the trades it executed), every on-chain correction and every mark, in a fixed order. The data
 * root is the Merkle root over the line hashes, in file order.
 *
 * Run it after `revealOutputHashes`: every season closes after 20:00, so all hashes are written by then.
 * Correction notes and runner signatures are private and are left out; their hashes are on-chain.
 */
export async function buildReplayFile(db: Queryable, season: number, contracts: ReplayContracts): Promise<ReplayFile> {
  const { rows: seasons } = await db.query<{ starts_at: Date; ends_at: Date; kind: string; rules: string | null }>(
    "select starts_at, ends_at, kind::text as kind, trust_rules_version as rules from seasons where id = $1::int",
    [season],
  );
  const s = seasons[0];
  if (!s) throw new Error(`no seasons row for ${season}`);

  const lines: object[] = [
    {
      type: "season",
      season,
      starts_at: new Date(s.starts_at).toISOString(),
      ends_at: new Date(s.ends_at).toISOString(),
      kind: s.kind,
      trust_rules_version: s.rules,
      chain_id: contracts.chainId,
      season_ledger: contracts.seasonLedger.toLowerCase(),
      paper_ledger: contracts.paperLedger.toLowerCase(),
      from_block: contracts.fromBlock,
    },
  ];

  const { rows: decisions } = await db.query<{
    id: string; bot_id: string; version: number; slot_id: string; slot_kind: string; slot_time: Date;
    prompt_version: string; model: string; input_json: unknown; input_hash: string; raw_output_json: unknown;
    output_hash: string | null; gate_result: unknown; status: string; trades: unknown[] | null;
  }>(
    `select d.id::text as id, d.bot_id::text as bot_id, d.version, d.slot_id::text as slot_id,
            s.kind::text as slot_kind, s.slot_time, d.prompt_version, d.model, d.input_json,
            encode(d.input_hash, 'hex') as input_hash, d.raw_output_json, encode(d.output_hash, 'hex') as output_hash,
            d.gate_result, d.status::text as status,
            (select jsonb_agg(jsonb_build_object(
                      'order_id', '0x' || encode(t.order_id, 'hex'), 'action_index', t.action_index,
                      'asset', t.asset::text, 'side', t.side::text, 'cash_e8', t.cash_e8::text,
                      'units_e18', t.units_e18::text, 'price_e8', t.price_e8::text, 'round_id', t.round_id::text,
                      'tx_hash', t.tx_hash, 'log_index', t.log_index, 'block_number', t.block_number::text)
                    order by t.block_number, t.log_index)
             from trades t where t.decision_id = d.id and t.tx_hash is not null) as trades
     from decisions d join slots s on s.id = d.slot_id
     where s.season_id = $1::int
     order by s.slot_time, d.slot_id, d.bot_id`,
    [season],
  );
  for (const d of decisions) {
    lines.push({
      type: "decision",
      id: d.id,
      bot_id: d.bot_id,
      version: d.version,
      slot_id: d.slot_id,
      slot_kind: d.slot_kind,
      slot_time: new Date(d.slot_time).toISOString(),
      prompt_version: d.prompt_version,
      model: d.model,
      input: readExact(d.input_json),
      input_hash: hex(d.input_hash),
      raw_output: d.raw_output_json === null ? null : readExact(d.raw_output_json),
      output_hash: hex(d.output_hash),
      gate_result: d.gate_result,
      status: d.status,
      trades: d.trades ?? [],
    });
  }

  const { rows: corrections } = await db.query<{
    id: string; bot_id: string; decision_id: string; chip: string; note_hash: string | null; tx_hash: string; created_at: Date;
  }>(
    `select c.id::text as id, c.bot_id::text as bot_id, c.decision_id::text as decision_id, c.chip,
            encode(c.note_hash, 'hex') as note_hash, c.tx_hash, c.created_at
     from corrections c
     where c.tx_hash is not null and c.created_at >= $1::timestamptz and c.created_at < $2::timestamptz
     order by c.created_at, c.id`,
    [new Date(s.starts_at).toISOString(), new Date(s.ends_at).toISOString()],
  );
  for (const c of corrections) {
    lines.push({
      type: "correction",
      id: c.id,
      bot_id: c.bot_id,
      decision_id: c.decision_id,
      chip: c.chip,
      note_hash: hex(c.note_hash),
      tx_hash: c.tx_hash,
      created_at: new Date(c.created_at).toISOString(),
    });
  }

  const { rows: marks } = await db.query<{ bot_id: string; slot_id: string; slot_time: Date; cash_e8: string; holdings: unknown; value_e8: string }>(
    `select m.bot_id::text as bot_id, m.slot_id::text as slot_id, s.slot_time, m.cash_e8::text as cash_e8,
            m.holdings, m.value_e8::text as value_e8
     from portfolio_marks m join slots s on s.id = m.slot_id
     where s.season_id = $1::int
     order by s.slot_time, m.slot_id, m.bot_id`,
    [season],
  );
  for (const m of marks) {
    lines.push({
      type: "mark",
      bot_id: m.bot_id,
      slot_id: m.slot_id,
      slot_time: new Date(m.slot_time).toISOString(),
      cash_e8: m.cash_e8,
      holdings: m.holdings,
      value_e8: m.value_e8,
    });
  }

  const text = lines.map((line) => canonicalJson(line));
  const leaves = text.map(hashText);
  return { lines: text, leaves, root: merkleRoot(leaves), text: `${text.join("\n")}\n` };
}
