import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { PGlite } from "@electric-sql/pglite";
import { decisionIdFromUuid } from "@botfolio/shared";
import { keccak256, stringToHex, type Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthenticator } from "../../src/auth/authenticator";
import { RelayJwt } from "../../src/auth/jwt";
import { CORRECTION_NOTE_PATH, correctionNoteRoutes } from "../../src/corrections/route";
import { HealthState } from "../../src/health";
import { seasonLedgerHandlers } from "../../src/indexer/handlers/season-ledger";
import type { EventContext } from "../../src/indexer/handlers/types";
import type { Queryable } from "../../src/scheduler/db";
import { createWorkerServer } from "../../src/server";
import { addSlot, testDb } from "../decisions/helpers";

const ORIGIN = "https://app.example";
const OWNER = `0x${"7".padStart(40, "0")}` as Hex; // bot 7's owner in testDb
const OTHER = `0x${"8".padStart(40, "0")}` as Hex; // bot 8's owner
const jwt = new RelayJwt("test-only-secret-".padEnd(40, "x"));
const NOTE = "stop chasing gold";
const HASH = keccak256(stringToHex(NOTE));
const TX = `0x${"ab".repeat(32)}` as Hex;

let pg: PGlite;
let db: Queryable;
let server: Server;
let base: string;
let decision: string;

async function post(body: Record<string, unknown>, wallet: Hex | null = OWNER) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN };
  if (wallet) Object.assign(headers, { authorization: `Bearer ${(await jwt.sign(wallet)).token}`, "x-botfolio-auth": "siwe" });
  const res = await fetch(base + CORRECTION_NOTE_PATH, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as { ok: boolean; error?: { code: string } } };
}
const good = (over: Record<string, unknown> = {}) => ({ botId: "7", decisionId: decision, chip: 0, note: NOTE, noteHash: HASH, ...over });
const rows = async () =>
  (await pg.query<{ chip: string; note: string; tx_hash: string | null; user_wallet: string }>("select chip, note, tx_hash, user_wallet from corrections order by id")).rows;

beforeEach(async () => {
  ({ pg, db } = await testDb());
  const slot = await addSlot(pg, "2026-11-26T09:00:00");
  const { rows: d } = await pg.query<{ id: string }>(
    `insert into decisions (bot_id, version, slot_id, prompt_version, model, input_json, input_hash, status)
     values (7, 1, $1, 'p', 'm', '{}', decode(repeat('00', 32), 'hex'), 'executed') returning id::text as id`,
    [slot.id],
  );
  decision = d[0]!.id;
  server = createWorkerServer({
    health: new HealthState({ provider: "fake", capUsd: null }),
    routes: correctionNoteRoutes({ origins: new Set([ORIGIN]), auth: createAuthenticator({ jwt, privy: null }), log: vi.fn(), db }),
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await pg.close();
});

describe("POST /corrections/note", () => {
  it("stores the owner's note as a pending row, once, and the indexer attaches the signed event to it", async () => {
    expect((await post(good())).status).toBe(200);
    expect((await post(good())).status).toBe(200); // a retry isn't a second row
    expect(await rows()).toEqual([{ chip: "too risky", note: NOTE, tx_hash: null, user_wallet: OWNER }]);

    const ctx = {
      db, chain: { blockTime: async () => 1_795_000_000n }, txEvents: [], block: 1n, stateBlock: 1n, txHash: TX, logIndex: 0,
    } as unknown as EventContext;
    const args = { botId: 7n, decisionId: decisionIdFromUuid(decision), noteHash: HASH, chip: 0, season: 1 };
    expect(await seasonLedgerHandlers.CallCorrected(args, ctx)).toEqual({ kind: "written" });
    expect(await rows()).toEqual([{ chip: "too risky", note: NOTE, tx_hash: TX, user_wallet: OWNER }]);
  });

  it("only for the caller's own bot and that bot's decision", async () => {
    expect((await post(good(), null)).status).toBe(401);
    expect((await post(good(), OTHER)).status).toBe(404);
    expect((await post(good({ botId: "8" }), OTHER)).status).toBe(404); // the decision is bot 7's
    expect(await rows()).toEqual([]);
  });

  it("refuses a note whose hash doesn't match, and anything that isn't one clean line", async () => {
    expect((await post(good({ noteHash: keccak256(stringToHex("something else")) }))).body.error?.code).toBe("BAD_NOTE_HASH");
    for (const note of ["", " padded ", "x".repeat(81), "line\nbreak", "see https://evil.example", "buy now on binance"]) {
      const res = await post(good({ note, noteHash: keccak256(stringToHex(note)) }));
      expect(res.status, note).toBe(400);
    }
    expect((await post(good({ chip: 4 }))).status).toBe(400); // "blocked" carries no note
    expect((await post(good({ decisionId: "not-a-uuid" }))).status).toBe(400);
    expect(await rows()).toEqual([]);
  });
});
