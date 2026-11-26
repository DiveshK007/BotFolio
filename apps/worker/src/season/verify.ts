import { ASSETS, type AssetId } from "@botfolio/shared";
import { decodeEventLog, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { canonicalJson, hashJson, hashText } from "../canonical";
import { publicJson } from "../decisions/json";
import { readGateInput, type StoredGateInput } from "../decisions/replay";
import { gate } from "../gate/gate";
import { shrinkBigMove } from "../gate/shrink";
import { ASSET_INDEX } from "../interfaces";
import { residual } from "../slot/stored";
import { merkleRoot } from "./merkle";

export interface Finding {
  line: number;
  what: string;
}

export interface OfflineResult {
  root: Hex;
  lines: number;
  decisions: number;
  findings: Finding[];
  season: SeasonLine;
  /** Every parsed line, for the chain checks. */
  parsed: Line[];
}

interface SeasonLine {
  type: "season";
  season: number;
  season_ledger: Address;
  paper_ledger: Address;
  from_block: string;
  chain_id: number;
}
interface TradeRow {
  order_id: Hex; action_index: number; asset: AssetId; side: "BUY" | "SELL"; cash_e8: string; units_e18: string;
  price_e8: string; round_id: string; tx_hash: Hex; log_index: number; block_number: string;
}
interface DecisionLine {
  type: "decision";
  id: string;
  bot_id: string;
  input: unknown;
  input_hash: Hex;
  raw_output: unknown;
  output_hash: Hex | null;
  gate_result: StoredResult;
  trades: TradeRow[];
}
type Line = SeasonLine | DecisionLine | { type: "correction" | "mark"; bot_id: string };

interface StoredResult {
  rulesVersion: string;
  replay?: { input: StoredGateInput };
  retries?: { indexes: number[]; input: StoredGateInput; output: unknown; result: Record<string, unknown> }[];
  shrinks?: { orderId: Hex; actionIndex: number; pending: { asset: AssetId; buy: boolean; bps: number; deadline: number; startUnitsE18?: string }; input: StoredGateInput; order: unknown }[];
  [key: string]: unknown;
}

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/**
 * Everything a replay can check without a chain (SPEC §6.5): each line is canonical, the root, both hashes of
 * every decision, and that gate() gives the logged result again (stale retries and expiry shrinks included).
 */
export function verifyOffline(text: string): OfflineResult {
  const raw = text.endsWith("\n") ? text.slice(0, -1) : text;
  const lines = raw.split("\n");
  const findings: Finding[] = [];
  const parsed: Line[] = [];

  lines.forEach((line, i) => {
    let value: Line;
    try {
      value = JSON.parse(line) as Line;
    } catch {
      findings.push({ line: i + 1, what: "not JSON" });
      return;
    }
    if (canonicalJson(value) !== line) findings.push({ line: i + 1, what: "not canonical JSON" });
    parsed.push(value);
  });
  const season = parsed[0];
  if (!season || season.type !== "season") throw new Error("the first line must be the season line");

  let decisions = 0;
  parsed.forEach((line, i) => {
    if (line.type !== "decision") return;
    decisions++;
    const at = (what: string) => findings.push({ line: i + 1, what: `decision ${line.id}: ${what}` });

    if (hashJson(line.input) !== line.input_hash) at("input_hash doesn't match the input");
    if (line.raw_output !== null && line.output_hash !== hashJson(line.raw_output)) at("output_hash doesn't match the output");

    const { replay, llm: _llm, retries, shrinks, ...result } = line.gate_result;
    if (!replay) {
      at("no gate inputs to replay");
      return;
    }
    if (!same(publicJson(gate(readGateInput(replay.input), line.raw_output, result.rulesVersion)), result)) {
      at("gate() gives a different result");
    }
    for (const [n, retry] of (retries ?? []).entries()) {
      const again = gate(readGateInput(retry.input), residual(retry.output ?? line.raw_output, retry.indexes), result.rulesVersion);
      if (!same(publicJson({ orders: again.orders, bigMoves: again.bigMoves, events: again.events }), retry.result)) {
        at(`retry ${n + 1} gives a different result`);
      }
    }
    for (const shrink of shrinks ?? []) {
      const input = readGateInput(shrink.input);
      const again = shrinkBigMove({
        ...input,
        pending: {
          botId: input.bot.botId,
          asset: ASSET_INDEX[shrink.pending.asset],
          buy: shrink.pending.buy,
          bps: shrink.pending.bps,
          decisionId: input.decisionId,
          actionIndex: shrink.actionIndex,
          deadline: BigInt(shrink.pending.deadline),
        },
        orderUsed: false,
        trigger: "expired",
        // Logged from #347 on; older shrinks have none and replay as they ran.
        startUnitsE18: shrink.pending.startUnitsE18 === undefined ? undefined : BigInt(shrink.pending.startUnitsE18),
      });
      if (again.outcome !== "execute" || !same(publicJson(again.order), shrink.order)) at(`shrink of ${shrink.orderId} differs`);
    }
  });

  return { root: merkleRoot(lines.map(hashText)), lines: lines.length, decisions, findings, season, parsed };
}

const LEDGER = parseAbi([
  "event Trade(uint256 indexed botId, uint8 indexed asset, bool buy, uint256 cashE8, uint256 unitsE18, uint256 priceE8, uint80 roundId, uint256 updatedAt, bytes32 indexed decisionId, uint8 actionIndex)",
  "function portfolios(uint256 botId) view returns (uint128 cashE8, uint16 lastDay, uint8 tradesToday, bool init)",
  "function holdings(uint256 botId) view returns (uint256[5] units)",
  "function START_CASH_E8() view returns (uint256)",
]);
const SEASONS = parseAbi(["function seasons(uint32 n) view returns (uint64 start, uint64 end, bytes32 dataRoot, string dataURI, bool closed)"]);
const FEED = parseAbi(["function getRoundData(uint80 roundId) view returns (uint80, int256, uint256, uint256, uint80)"]);
const GET_LOGS_RANGE = 2000n;

export interface ChainResult {
  onChainRoot: Hex | null;
  trades: number;
  bots: number;
  findings: Finding[];
}

/**
 * The checks against QIE: the committed root, each trade's Trade event and the oracle round it priced against,
 * and each bot's balances recomputed from all of its Trade events since the deploy block.
 */
export async function verifyOnChain(client: PublicClient, offline: OfflineResult): Promise<ChainResult> {
  const { season, parsed } = offline;
  const findings: Finding[] = [];
  const ledger = season.paper_ledger;

  const [, , dataRoot, , closed] = await client.readContract({ address: season.season_ledger, abi: SEASONS, functionName: "seasons", args: [season.season] });
  if (closed && dataRoot.toLowerCase() !== offline.root.toLowerCase()) {
    findings.push({ line: 1, what: `on-chain root ${dataRoot} isn't the file's ${offline.root}` });
  }

  let trades = 0;
  for (const [i, line] of parsed.entries()) {
    if (line.type !== "decision") continue;
    for (const t of line.trades) {
      trades++;
      const at = (what: string) => findings.push({ line: i + 1, what: `trade ${t.order_id}: ${what}` });
      const receipt = await client.getTransactionReceipt({ hash: t.tx_hash });
      const log = receipt.logs.find((l) => l.logIndex === t.log_index);
      if (!log || log.address.toLowerCase() !== ledger.toLowerCase()) {
        at("no event from PaperLedger at that log index");
        continue;
      }
      const { eventName, args } = decodeEventLog({ abi: LEDGER, data: log.data, topics: log.topics });
      if (eventName !== "Trade") {
        at("that log isn't a Trade");
        continue;
      }
      const expected = {
        botId: BigInt(line.bot_id), asset: ASSET_INDEX[t.asset], buy: t.side === "BUY", cashE8: BigInt(t.cash_e8),
        unitsE18: BigInt(t.units_e18), priceE8: BigInt(t.price_e8), roundId: BigInt(t.round_id), actionIndex: t.action_index,
      };
      const actual = { botId: args.botId, asset: args.asset, buy: args.buy, cashE8: args.cashE8, unitsE18: args.unitsE18, priceE8: args.priceE8, roundId: args.roundId, actionIndex: args.actionIndex };
      if (!same(publicJson(actual), publicJson(expected))) at("the event doesn't match the file");

      const feed = ASSETS.find((a) => a.id === t.asset)!.feed;
      const [, answer] = await client.readContract({ address: feed, abi: FEED, functionName: "getRoundData", args: [BigInt(t.round_id)] });
      if (answer !== BigInt(t.price_e8)) at(`QIE's round ${t.round_id} says ${answer}, not ${t.price_e8}`);
    }
  }

  // Balances: start cash plus every Trade event of the bot equals what the ledger holds now.
  const bots = [...new Set(parsed.flatMap((l) => (l.type === "season" ? [] : [l.bot_id])))].map(BigInt);
  const startCash = await client.readContract({ address: ledger, abi: LEDGER, functionName: "START_CASH_E8" });
  const head = await client.getBlockNumber();
  const events: { botId: bigint; asset: number; buy: boolean; cashE8: bigint; unitsE18: bigint }[] = [];
  for (let from = BigInt(season.from_block); from <= head; from += GET_LOGS_RANGE) {
    const to = from + GET_LOGS_RANGE - 1n < head ? from + GET_LOGS_RANGE - 1n : head;
    const logs = await client.getLogs({ address: ledger, event: LEDGER[0], fromBlock: from, toBlock: to });
    for (const { args } of logs) events.push(args as (typeof events)[number]);
  }
  for (const botId of bots) {
    let cash = startCash;
    const units = [0n, 0n, 0n, 0n, 0n];
    for (const e of events) {
      if (e.botId !== botId) continue;
      cash = e.buy ? cash - e.cashE8 : cash + e.cashE8;
      units[e.asset] = e.buy ? units[e.asset]! + e.unitsE18 : units[e.asset]! - e.unitsE18;
    }
    const [[cashNow], unitsNow] = await Promise.all([
      client.readContract({ address: ledger, abi: LEDGER, functionName: "portfolios", args: [botId] }),
      client.readContract({ address: ledger, abi: LEDGER, functionName: "holdings", args: [botId] }),
    ]);
    if (cashNow !== cash || unitsNow.some((u, i) => u !== units[i])) {
      findings.push({ line: 0, what: `bot ${botId}: balances recomputed from its Trade events don't match the ledger` });
    }
  }

  return { onChainRoot: closed ? dataRoot : null, trades, bots: bots.length, findings };
}
