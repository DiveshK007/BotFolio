import type { Indexer } from "./indexer";
import type { Log } from "./log";

/** SPEC §6.1: continuous, a 10 s loop in-process. */
export const INTERVAL_MS = 10_000;
/** QIE makes a block every 3.6 s, so a minute with nothing written is a stall. */
export const STALL_MS = 60_000;

/**
 * Runs `tick` one at a time, for ever. An error is logged and retried on the next tick, from the same cursor.
 * While there is history to catch up on it doesn't wait between ranges.
 */
export function runLoop(
  indexer: Pick<Indexer, "tick">,
  log: Log,
  intervalMs: number = INTERVAL_MS,
): { stop(): Promise<void> } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();
  let progressAt = Date.now();

  const run = async () => {
    let delay = intervalMs;
    try {
      const { live, more } = await indexer.tick();
      if (live.status === "written") {
        progressAt = Date.now();
        if (live.written > 0) log.info("indexed", { from: live.from, to: live.to, written: live.written });
      } else if (Date.now() - progressAt >= STALL_MS) {
        // "idle" is also what a frozen RPC looks like.
        log.warn("no new blocks for a minute", { status: live.status });
        progressAt = Date.now();
      }
      if (more) delay = 0;
    } catch (e) {
      log.warn("tick failed, retrying", { error: e instanceof Error ? e.message : String(e) });
    }
    if (!stopped) timer = setTimeout(next, delay);
  };
  const next = () => {
    running = run();
  };
  next();

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
