import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WriteResult } from "../../src/indexer/indexer";
import { INTERVAL_MS, runLoop } from "../../src/indexer/loop";
import { memoryLog } from "./helpers/world";

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

const batch = (to: bigint, head: bigint): WriteResult => ({
  status: "written",
  from: 1n,
  to,
  head,
  written: 0,
  ignored: 0,
  problems: [],
});

it("ticks every 10 seconds", async () => {
  const tick = vi.fn(async (): Promise<WriteResult> => ({ status: "idle" }));
  const loop = runLoop({ tick }, memoryLog());
  expect(INTERVAL_MS).toBe(10_000);
  await vi.advanceTimersByTimeAsync(0);
  expect(tick).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(9_999);
  expect(tick).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(tick).toHaveBeenCalledTimes(2);
  await loop.stop();
});

it("doesn't wait between ranges while behind", async () => {
  const tick = vi.fn<() => Promise<WriteResult>>()
    .mockResolvedValueOnce(batch(10n, 30n))
    .mockResolvedValueOnce(batch(20n, 30n))
    .mockResolvedValue(batch(30n, 30n));
  const loop = runLoop({ tick }, memoryLog());
  await vi.advanceTimersByTimeAsync(5);
  expect(tick).toHaveBeenCalledTimes(3);
  await loop.stop();
});

it("survives an error and tries again", async () => {
  const log = memoryLog();
  const tick = vi.fn<() => Promise<WriteResult>>()
    .mockRejectedValueOnce(new Error("no RPC"))
    .mockResolvedValue({ status: "idle" });
  const loop = runLoop({ tick }, log);
  await vi.advanceTimersByTimeAsync(INTERVAL_MS);
  expect(tick).toHaveBeenCalledTimes(2);
  expect(log.lines).toEqual([{ message: "tick failed, retrying", fields: { error: "no RPC" } }]);
  await loop.stop();
});

it("never runs two ticks at once, and stop waits for the one running", async () => {
  let finish = () => {};
  const tick = vi.fn(() => new Promise<WriteResult>((resolve) => (finish = () => resolve({ status: "idle" }))));
  const loop = runLoop({ tick }, memoryLog());
  await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);
  expect(tick).toHaveBeenCalledTimes(1);

  let stopped = false;
  const stopping = loop.stop().then(() => (stopped = true));
  await vi.advanceTimersByTimeAsync(0);
  expect(stopped).toBe(false);
  finish();
  await stopping;
  await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
  expect(tick).toHaveBeenCalledTimes(1);
});
