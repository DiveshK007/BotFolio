import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TickResult } from "../../src/indexer/indexer";
import { INTERVAL_MS, STALL_MS, runLoop } from "../../src/indexer/loop";
import { memoryLog } from "./helpers/world";

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

const IDLE: TickResult = { live: { status: "idle" }, more: false };
const batch = (to: bigint, safeHead: bigint): TickResult => ({
  live: { status: "written", from: 1n, to, safeHead, written: 0, ignored: 0, problems: [] },
  more: to < safeHead,
});

it("ticks every 10 seconds", async () => {
  const tick = vi.fn(async () => IDLE);
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
  const tick = vi.fn<() => Promise<TickResult>>()
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
  const tick = vi.fn<() => Promise<TickResult>>()
    .mockRejectedValueOnce(new Error("no RPC"))
    .mockResolvedValue(IDLE);
  const loop = runLoop({ tick }, log);
  await vi.advanceTimersByTimeAsync(INTERVAL_MS);
  expect(tick).toHaveBeenCalledTimes(2);
  expect(log.lines).toEqual([{ message: "tick failed, retrying", fields: { error: "no RPC" } }]);
  await loop.stop();
});

it("never runs two ticks at once, and stop waits for the one running", async () => {
  let finish = () => {};
  const tick = vi.fn(() => new Promise<TickResult>((resolve) => (finish = () => resolve(IDLE))));
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

it("says so when a minute passes with no new block, which is also how a frozen RPC looks", async () => {
  const log = memoryLog();
  const loop = runLoop({ tick: async () => IDLE }, log);
  await vi.advanceTimersByTimeAsync(STALL_MS - 1);
  expect(log.lines).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(log.lines).toEqual([{ message: "no new blocks for a minute", fields: { status: "idle" } }]);
  await loop.stop();
});
