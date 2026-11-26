import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reverseLookup, sweepQieNames } from "../../src/qie-names/sweeper";
import type { Queryable } from "../../src/scheduler/db";

const sql = (path: string) => readFileSync(new URL(`../../../../packages/db/${path}`, import.meta.url), "utf8");
const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";

const sse = (structuredContent: object) =>
  new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent } })}\n\n`);

describe("reverseLookup (QIE Wallet MCP)", () => {
  it("reads the name from the SSE answer and sends qie_reverse_lookup", async () => {
    const fetch = vi.fn(async () => sse({ status: "ok", address: ALICE, name: "Alice.qie" }));
    expect(await reverseLookup(ALICE, { fetch })).toBe("alice.qie");
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.params).toEqual({ name: "qie_reverse_lookup", arguments: { address: ALICE, network: "mainnet" } });
  });

  it("null when the address has no QIE ID", async () => {
    expect(await reverseLookup(ALICE, { fetch: async () => sse({ status: "ok", address: ALICE, name: null }) })).toBeNull();
  });

  it("never shows anything but a plain label.qie", async () => {
    const odd = async () => sse({ status: "ok", address: ALICE, name: "<b>x</b>.qie" });
    expect(await reverseLookup(ALICE, { fetch: odd })).toBeNull();
  });

  it("throws (so it is retried, not cached) on errors and on an answer for another address", async () => {
    await expect(reverseLookup(ALICE, { fetch: async () => new Response("", { status: 502 }) })).rejects.toThrow();
    await expect(reverseLookup(ALICE, { fetch: async () => sse({ status: "unresolved" }) })).rejects.toThrow();
    await expect(reverseLookup(ALICE, { fetch: async () => sse({ status: "ok", address: BOB, name: "bob.qie" }) })).rejects.toThrow();
  });
});

describe("sweepQieNames", () => {
  let pglite: PGlite;
  let db: Queryable;
  const log = { info: vi.fn(), warn: vi.fn() };

  beforeEach(async () => {
    pglite = new PGlite();
    await pglite.exec(sql("schema.sql"));
    db = { query: async <Row extends object>(text: string, params?: unknown[]) => ({ rows: (await pglite.query<Row>(text, params)).rows }) };
    for (const [id, owner] of [[1, ALICE], [2, ALICE], [3, BOB]] as const) {
      await pglite.query("insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash) values ($1, $2, 'b', '', '', decode(repeat('00', 32), 'hex'))", [id, owner]);
    }
  }, 30_000);
  afterEach(() => pglite.close());

  const names = async () =>
    (await pglite.query<{ w: string; n: string | null }>("select wallet_address as w, qie_name as n from qie_names order by 1")).rows;

  it("caches each owner once, names and no-names alike, and skips fresh rows next time", async () => {
    const lookup = vi.fn(async (a: string) => (a === ALICE ? "alice.qie" : null));
    expect(await sweepQieNames({ db, log, lookup })).toBe(2);
    expect(await names()).toEqual([{ w: ALICE, n: "alice.qie" }, { w: BOB, n: null }]);
    expect(await sweepQieNames({ db, log, lookup })).toBe(0);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("re-checks after 24 h", async () => {
    await sweepQieNames({ db, log, lookup: async () => null });
    await pglite.query("update qie_names set checked_at = now() - interval '25 hours' where wallet_address = $1", [ALICE]);
    const lookup = vi.fn(async () => "alice.qie");
    expect(await sweepQieNames({ db, log, lookup })).toBe(1);
    expect(lookup).toHaveBeenCalledWith(ALICE);
  });

  it("a failed lookup writes nothing and is tried again", async () => {
    await sweepQieNames({ db, log, lookup: async () => { throw new Error("down"); } });
    expect(await names()).toEqual([]);
    expect(log.warn).toHaveBeenCalledWith("qie_names.lookup_failed", { cause: "down" });
  });
});
