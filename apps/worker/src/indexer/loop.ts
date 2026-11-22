import type { Indexer } from "./indexer";
import type { Log } from "./log";

/** SPEC §6.1: continuous, a 10 s loop in-process. */
export const INTERVAL_MS = 10_000;

/**
 * Runs `tick` one at a time, for ever. An error is logged and retried on the next tick, from the same cursor.
 * While behind the head it doesn't wait between ranges.
 */
export function runLoop(
  indexer: Pick<Indexer, "tick">,
  log: Log,
  intervalMs: number = INTERVAL_MS,
): { stop(): Promise<void> } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const run = async () => {
    let delay = intervalMs;
    try {
      const result = await indexer.tick();
      if (result.status === "written") {
        if (result.written > 0) {
          log.info("indexed", { from: result.from, to: result.to, written: result.written });
        }
        if (result.to < result.head) delay = 0;
      }
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
