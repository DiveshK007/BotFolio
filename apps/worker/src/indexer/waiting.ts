import type { Problem } from "./apply";

/** How often, how many, and how much is remembered. A restart's repair pass finds them all again. */
export const RETRY_EVERY_MS = 60_000;
export const RETRY_BLOCKS = 10;
export const MAX_WAITING_BLOCKS = 1000;

/**
 * Blocks with an event that is waiting for someone else's row (a decision, a seeded season). They are replayed
 * until the row turns up. Skipped events (hostile or impossible) are never kept here.
 */
export class WaitingBlocks {
  private readonly blocks = new Set<bigint>();
  private dueAt = 0;

  get size(): number {
    return this.blocks.size;
  }

  /** After the range committed: these are now the only ones in it still waiting. */
  update(from: bigint, to: bigint, problems: Problem[]): void {
    const waiting = new Set(problems.filter((p) => p.kind === "waiting").map((p) => p.block));
    for (const block of this.blocks) {
      if (block >= from && block <= to && !waiting.has(block)) this.blocks.delete(block);
    }
    for (const block of waiting) {
      if (this.blocks.has(block)) continue;
      if (this.blocks.size >= MAX_WAITING_BLOCKS) this.blocks.delete(this.blocks.values().next().value!);
      this.blocks.add(block);
    }
  }

  /** The next few, at most once a minute. They move to the back first, so one bad block can't starve the rest. */
  take(now: number): bigint[] {
    if (this.blocks.size === 0 || now < this.dueAt) return [];
    this.dueAt = now + RETRY_EVERY_MS;
    const next = [...this.blocks].slice(0, RETRY_BLOCKS);
    for (const block of next) {
      this.blocks.delete(block);
      this.blocks.add(block);
    }
    return next;
  }
}
