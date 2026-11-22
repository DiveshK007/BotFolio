import { applyLogs, type BatchResult, type Problem } from "./apply";
import { ChainError, type ChainSource } from "./chain";
import type { ContractAddresses } from "./config";
import type { Db } from "./db";
import { decodeLogs } from "./decode";
import type { Log } from "./log";

/** QIE's RPCs refuse getLogs over more than 10,000 blocks (checked on rpc3/4/5, Nov 22 2026). Stay well inside. */
export const MAX_RANGE = 2000n;

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
}

export type WriteResult =
  | { status: "idle" | "busy" }
  | ({ status: "written"; from: bigint; to: bigint; head: bigint } & BatchResult);

export class Indexer {
  /** The first block not written yet. It only moves after the transaction that wrote the rows has committed. */
  private next: bigint;
  private readonly maxRange: bigint;
  private readonly reported = new Set<string>();

  constructor(private readonly deps: IndexerDeps) {
    if (deps.sources.length === 0) throw new Error("the indexer needs at least one RPC");
    this.next = deps.startBlock;
    this.maxRange = deps.maxRange ?? MAX_RANGE;
  }

  get nextBlock(): bigint {
    return this.next;
  }

  async tick(): Promise<WriteResult> {
    const result = await this.write(this.next);
    if (result.status === "written" && result.to >= this.next) this.next = result.to + 1n;
    return result;
  }

  /**
   * Writes an already indexed range again, with the same rows as the outcome. It refuses blocks past the cursor:
   * rows from there would say that everything before them was indexed too.
   */
  async replay(from: bigint, to: bigint): Promise<void> {
    if (from < this.deps.startBlock || from > to || to >= this.next) {
      throw new RangeError(`can only replay ${this.deps.startBlock}..${this.next - 1n}, got ${from}..${to}`);
    }
    for (let at = from; at <= to; ) {
      const result = await this.write(at, to);
      if (result.status !== "written") throw new Error(`replay stopped at block ${at}: ${result.status}`);
      at = result.to + 1n;
    }
  }

  /** One range, on the first endpoint that can serve all of it. `last` caps a replay. */
  private async write(from: bigint, last?: bigint): Promise<WriteResult> {
    // Contract state is read at or past everything indexed, or a replay would write an older status back.
    const needed = last === undefined ? from : this.next - 1n;
    const failures: string[] = [];
    let behind = false;

    for (const source of this.deps.sources) {
      try {
        await source.check();
        const head = await source.head();
        if (head < needed) {
          behind = true;
          continue;
        }
        const to = min(from + this.maxRange - 1n, last ?? head, head);
        return await this.writeRange(source, from, to, needed, head);
      } catch (e) {
        if (!(e instanceof ChainError)) throw e; // a database problem: another RPC won't fix it
        failures.push(e.message);
      }
    }
    if (behind) return { status: "idle" };
    throw new ChainError(`no RPC could serve blocks from ${from}: ${failures.join("; ")}`);
  }

  private async writeRange(
    source: ChainSource,
    from: bigint,
    to: bigint,
    needed: bigint,
    head: bigint,
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
        stateBlock = await source.head();
        if (stateBlock < to || stateBlock < needed) throw new ChainError(`${source.name} went back to ${stateBlock}`);
      }
      return applyLogs(tx, decoded, source, stateBlock);
    });

    if (!batch) return { status: "busy" };
    this.report(batch.problems);
    return { status: "written", from, to, head, ...batch };
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
