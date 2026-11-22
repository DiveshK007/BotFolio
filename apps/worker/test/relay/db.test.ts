import { EventEmitter } from "node:events";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../../src/relay/db";

afterEach(() => void vi.restoreAllMocks());

describe("openDb", () => {
  it("survives a connection that dies mid-transaction, and discards it", async () => {
    const client = Object.assign(new EventEmitter(), { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() });
    vi.spyOn(pg.Pool.prototype, "connect").mockResolvedValue(client as never);

    const log = vi.fn();
    const run = openDb({}, log).transaction(async () => {
      // With no listener an EventEmitter 'error' throws, which takes the whole worker down.
      client.emit("error", new Error("terminated postgres://user:hunter2@db"));
      throw new Error("query failed");
    });
    await expect(run).rejects.toThrow("query failed");
    expect(client.release).toHaveBeenCalledWith(true);
    expect(client.listenerCount("error")).toBe(0);
    expect(JSON.stringify(log.mock.calls)).not.toContain("hunter2");
  });
});
