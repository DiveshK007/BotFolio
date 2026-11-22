import { applyLogs, type BatchResult, type Problem } from "./apply";
import { ChainError, type ChainSource } from "./chain";
import type { ContractAddresses } from "./config";
import type { Db } from "./db";
import { decodeLogs } from "./decode";
import type { Log } from "./log";
import { checkStartBlock, resumeBlock } from "./resume";
import { WaitingBlocks } from "./waiting";

/** QIE's RPCs refuse getLogs over more than 10,000 blocks (checked on rpc3/4/5, Nov 22 2026). Stay well inside. */
export const MAX_RANGE = 5000n;
/** A block is indexed once two more are on top of it (#196). About 7 s at QIE's 3.6 s blocks. */
export const CONFIRMATIONS = 2n;
/**
 * Every pass reads the last few indexed blocks again. That picks up logs a node served late (it answers [] rather
 * than an error) and events re-mined by a reorg a little deeper than the confirmations.
 */
export const OVERLAP = 10n;
/** A cursor this far past every RPC's head is a wrong start block, or another chain's database. */
const AHEAD_OF_CHAIN = 100n;

// Transaction-level, so it works behind a transaction-mode pooler and can't outlive a crashed process.
const LOCK = [1990, 46];
const MAX_REPORTED = 10_000;

export interface IndexerDeps {
  db: Db;
  /** In failover order. */
  sources: ChainSource[];
  addresses: ContractAddresses;
  startBlock: bigint;
  log: Log;
  maxRange?: bigint;
  now?: () => number;
}

export type WriteResult =
  | { status: "idle" | "busy" }
  | ({ status: "written"; from: bigint; to: bigint; safeHead: bigint } & BatchResult);

export interface TickResult {
  live: WriteResult;
  /** There is more history to read: tick again without waiting. */
  more: boolean;
}

/** Blocks per getLogs. Halved while every RPC fails on a range (too many logs, timeouts), doubled on success. */
interface Span {
  size: bigint;
}

interface Range {
  from: bigint;
  span: Span;
  /** An endpoint must be able to read state here: at or past everything indexed. */
  needed: bigint;
  /** Caps a replay. */
  last?: bigint;
}

export class Indexer {
  /** The first block not written yet. It only moves after the transaction that wrote the rows has committed. */
  private next: bigint;
  private ready = false;
  /** Blocks below the resume point, read again in the background after a restart. */
  private repair: { at: bigint; last: bigint } | null = null;
  private readonly waiting = new WaitingBlocks();
  private readonly maxRange: bigint;
  // Separate, or each successful live range would undo the shrinking a dense stretch of history needs.
  private readonly liveSpan: Span;
  private readonly historySpan: Span;
  private readonly now: () => number;
  private readonly reported = new Set<string>();

  constructor(private readonly deps: IndexerDeps) {
    if (deps.sources.length === 0) throw new Error("the indexer needs at least one RPC");
    this.next = deps.startBlock;
    this.maxRange = deps.maxRange ?? MAX_RANGE;
    this.liveSpan = { size: this.maxRange };
    this.historySpan = { size: this.maxRange };
    this.now = deps.now ?? Date.now;
  }

  get nextBlock(): bigint {
    return this.next;
  }

  /** New blocks first. History (the repair pass, waiting events) only once those are written. */
  async tick(): Promise<TickResult> {
    if (!this.ready) await this.resume();

    const live = await this.write({ from: this.liveFrom(), span: this.liveSpan, needed: this.next });
    if (live.status === "busy") return { live, more: false };
    if (live.status === "written") {
      if (live.to >= this.next) this.next = live.to + 1n;
      if (live.to < live.safeHead) return { live, more: true };
    }

    try {
      await this.retryWaiting();
      return { live, more: await this.repairStep() };
    } catch (e) {
      // History must never hold up new blocks.
      this.deps.log.warn("replay failed, retrying", { error: e instanceof Error ? e.message : String(e) });
      return { live, more: false };
    }
  }

  /**
   * Writes an already indexed range again, with the same rows as the outcome. It refuses blocks past the cursor:
   * a trade stored from there would move the resume point over blocks nobody indexed.
   */
  async replay(from: bigint, to: bigint): Promise<void> {
    if (from < this.deps.startBlock || from > to || to >= this.next) {
      throw new RangeError(`can only replay ${this.deps.startBlock}..${this.next - 1n}, got ${from}..${to}`);
    }
    for (let at = from; at <= to; ) {
      const result = await this.writeHistory(at, to);
      if (result.status !== "written") throw new Error(`replay stopped at block ${at}: ${result.status}`);
      at = result.to + 1n;
    }
  }

  private async resume(): Promise<void> {
    const { db, sources, startBlock, log } = this.deps;
    await checkStartBlock(sources, startBlock, log);
    this.next = await resumeBlock(db, startBlock);
    if (this.next > startBlock) {
      // Safe to be live straight away. The pass below also finds what was waiting when the last process died,
      // and indexes the history of an address that has changed.
      this.repair = { at: startBlock, last: this.next - 1n };
    }
    this.ready = true;
    log.info("resuming", { startBlock, nextBlock: this.next });
  }

  private liveFrom(): bigint {
    // A shrunk span couldn't get past the overlap.
    if (this.liveSpan.size <= OVERLAP * 2n) return this.next;
    const from = this.next - OVERLAP;
    return from > this.deps.startBlock ? from : this.deps.startBlock;
  }

  private async repairStep(): Promise<boolean> {
    if (!this.repair) return false;
    const { at, last } = this.repair;
    const result = await this.writeHistory(at, last);
    if (result.status !== "written") return false;
    if (result.to < last) {
      this.repair = { at: result.to + 1n, last };
      return true;
    }
    this.repair = null;
    this.deps.log.info("repair pass done", { upTo: last });
    return false;
  }

  private async retryWaiting(): Promise<void> {
    for (const block of this.waiting.take(this.now())) {
      const result = await this.writeHistory(block, block);
      if (result.status !== "written") return;
    }
  }

  private writeHistory(from: bigint, last: bigint): Promise<WriteResult> {
    return this.write({ from, span: this.historySpan, needed: this.next - 1n, last });
  }

  /** One range, on the first endpoint that can serve all of it. */
  private async write({ from, span, needed, last }: Range): Promise<WriteResult> {
    const failures: string[] = [];
    let highest: bigint | undefined;
    let rangeFailed = false;

    for (const source of this.deps.sources) {
      let serving = false;
      try {
        await source.check();
        const head = await source.head();
        if (highest === undefined || head > highest) highest = head;
        const safe = head - CONFIRMATIONS;
        if (safe < needed) continue;

        serving = true;
        const to = min(from + span.size - 1n, last ?? safe, safe);
        const result = await this.writeRange(source, { from, to, needed, safeHead: safe });
        if (result.status === "written") span.size = min(span.size * 2n, this.maxRange);
        return result;
      } catch (e) {
        if (!(e instanceof ChainError)) throw e; // a database problem: another RPC won't fix it
        failures.push(e.message);
        rangeFailed ||= serving;
      }
    }

    if (rangeFailed) {
      if (span.size > 1n) span.size /= 2n;
    } else if (highest !== undefined) {
      if (needed > highest + AHEAD_OF_CHAIN) {
        throw new ChainError(
          `block ${needed} is past the chain's head ${highest}: check INDEXER_START_BLOCK, DATABASE_URL and the RPCs`,
        );
      }
      return { status: "idle" };
    }
    throw new ChainError(`no RPC could serve blocks from ${from}: ${failures.join("; ")}`);
  }

  private async writeRange(
    source: ChainSource,
    { from, to, needed, safeHead }: { from: bigint; to: bigint; needed: bigint; safeHead: bigint },
  ): Promise<WriteResult> {
    const { db, addresses } = this.deps;
    const decoded = decodeLogs(await source.logs(from, to), addresses, { from, to });

    const batch = await db.transaction(async (tx) => {
      // Two workers overlap during a deploy. One writes at a time, and reads contract state only once it holds
      // the lock, so it can't commit older state over newer.
      const { rows } = await tx.query<{ locked: boolean }>(
        "select pg_try_advisory_xact_lock($1::int, $2::int) as locked",
        LOCK,
      );
      if (!rows[0]?.locked) return null;

      let stateBlock = to;
      if (decoded.events.length > 0) {
        stateBlock = (await source.head()) - CONFIRMATIONS;
        if (stateBlock < to || stateBlock < needed) throw new ChainError(`${source.name} went back to ${stateBlock}`);
      }
      return applyLogs(tx, decoded, source, stateBlock);
    });

    if (!batch) return { status: "busy" };
    this.waiting.update(from, to, batch.problems);
    this.report(batch.problems);
    return { status: "written", from, to, safeHead, ...batch };
  }

  /** Called after the commit, and once per event and reason, so replays don't flood the log. */
  private report(problems: Problem[]): void {
    for (const problem of problems) {
      const key = `${problem.txHash}:${problem.logIndex}:${problem.reason}`;
      if (this.reported.has(key)) continue;
      if (this.reported.size >= MAX_REPORTED) this.reported.clear();
      this.reported.add(key);
      this.deps.log.warn(`event ${problem.kind}`, problem);
    }
  }
}

function min(...values: bigint[]): bigint {
  return values.reduce((a, b) => (b < a ? b : a));
}
