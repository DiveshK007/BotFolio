import { ChainError, type ChainSource } from "./chain";
import type { Queryable } from "./db";
import type { Log } from "./log";

/**
 * Where to pick up after a restart. The frozen schema has no cursor table, so the cursor comes from the rows.
 *
 * A range commits in one transaction and ranges commit in chain order, so a trade stored at block B proves that
 * every block up to B was committed. trades is the only table with a block number and only the indexer sets it
 * (SPEC §3: optimistic rows have it null). Re-reading from B + 1 is safe because replays are idempotent.
 * With no trade yet, it is the start block.
 */
export async function resumeBlock(db: Queryable, startBlock: bigint): Promise<bigint> {
  const { rows } = await db.query<{ block: string | null }>(
    "select max(block_number)::text as block from trades where tx_hash is not null",
  );
  const block = rows[0]?.block;
  if (block === null || block === undefined) return startBlock;
  const next = BigInt(block) + 1n;
  return next > startBlock ? next : startBlock;
}

/**
 * Start block = deploy block (#196). A block later than the deploy would lose events without any sign of it, so
 * a contract that already has code one block earlier stops the indexer. It needs historical `eth_getCode`
 * (rpc3/4/5 served state 500,000 blocks back on Nov 22 2026). Without it this warns and goes on.
 */
export async function checkStartBlock(sources: ChainSource[], startBlock: bigint, log: Log): Promise<void> {
  if (startBlock === 0n) return;
  const failures: string[] = [];
  let reachable = false;

  for (const source of sources) {
    let late: boolean;
    try {
      await source.check();
      reachable = true;
      late = await source.hasCodeAt(startBlock - 1n);
    } catch (e) {
      if (!(e instanceof ChainError)) throw e;
      failures.push(e.message);
      continue;
    }
    if (late) {
      throw new Error(
        `INDEXER_START_BLOCK ${startBlock} is after the deploy and would miss events. Set it to the deploy block.`,
      );
    }
    return;
  }

  if (!reachable) throw new ChainError(`no RPC is usable: ${failures.join("; ")}`);
  log.warn("can't verify that the start block is the deploy block", { startBlock, failures });
}
