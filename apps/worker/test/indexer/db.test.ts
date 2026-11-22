import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
import { createPgDb } from "../../src/indexer/db";

// The SQL runs on PGlite in the other tests. This covers what the `pg` adapter itself decides.
const fake = vi.hoisted(() => ({ pool: undefined as unknown, client: undefined as unknown, options: [] as object[] }));

vi.mock("pg", () => ({
  Pool: class {
    constructor(options: object) {
      fake.options.push(options);
      return fake.pool as object;
    }
  },
}));

let statements: string[];
let failOn: string | undefined;
let client: EventEmitter & { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
let pool: EventEmitter & { connect: () => Promise<typeof client> };

beforeEach(() => {
  statements = [];
  failOn = undefined;
  fake.options.length = 0;
  client = Object.assign(new EventEmitter(), {
    query: vi.fn(async (text: string) => {
      statements.push(text);
      if (text === failOn) throw new Error(`${text} failed`);
      return { rows: [] };
    }),
    release: vi.fn(),
  });
  pool = Object.assign(new EventEmitter(), { connect: async () => client });
  fake.pool = pool;
});

const db = () => createPgDb({ connectionString: "postgres://u:p@localhost/db" });

it("commits, and gives the connection back", async () => {
  await db().transaction((tx) => tx.query("write"));
  expect(statements).toEqual(["begin", "write", "commit"]);
  expect(client.release).toHaveBeenCalledWith(undefined);
});

it.each(["write", "commit"])("rolls back and rethrows when %s fails", async (statement) => {
  failOn = statement;
  await expect(db().transaction((tx) => tx.query("write"))).rejects.toThrow(`${statement} failed`);
  expect(statements.at(-1)).toBe("rollback");
  expect(client.release).toHaveBeenCalledWith(undefined);
});

it("throws away a connection that can't even roll back", async () => {
  failOn = "rollback";
  await expect(
    db().transaction(async () => {
      throw new Error("handler failed");
    }),
  ).rejects.toThrow("handler failed");
  expect(client.release).toHaveBeenCalledWith(expect.any(Error));
});

it("a dropped connection, idle or in use, can't crash the worker", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const adapter = db();
  expect(() => pool.emit("error", new Error("idle client lost"))).not.toThrow();
  await adapter.transaction(async () => {
    expect(() => client.emit("error", new Error("busy client lost"))).not.toThrow();
  });
  expect(logged).toHaveBeenCalledTimes(2);
  expect(client.listenerCount("error")).toBe(0);
  logged.mockRestore();
});

it("bounds every query, and passes the TLS setting through", () => {
  createPgDb({ connectionString: "postgres://u:p@db.example.com/db", ssl: true });
  expect(fake.options[0]).toMatchObject({ ssl: true, query_timeout: 30_000, connectionTimeoutMillis: 10_000 });
});
