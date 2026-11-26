import { afterEach, describe, expect, it, vi } from "vitest";
import { countdown, fetchChallenge, nextSlot, parseBigMoves, parseChallenge, parseDailyCall, parseDailyView, parseOwner, shortCode, viewForPick } from "./owner";

afterEach(() => vi.unstubAllGlobals());

describe("viewForPick (POST /daily-call/view, #326)", () => {
  const auth = { authKind: "privy" as const, getAuthToken: async () => "t" };
  const view = (botUp: boolean) => ({ ok: true, view: { botId: "7", day: 20418, botUp, botSig: "0xabcd" } });
  const locked = { ok: false, error: { code: "PICK_LOCKED", message: "You already picked the other way today. A pick can't change." } };
  const stub = (answers: [number, unknown][]) => {
    const f = vi.fn<typeof fetch>(async () => {
      const [status, body] = answers.shift()!;
      return new Response(JSON.stringify(body), { status });
    });
    vi.stubGlobal("fetch", f);
    return f;
  };
  const bodies = (f: ReturnType<typeof stub>) => f.mock.calls.map(([, init]) => JSON.parse(init!.body as string));

  it("sends the owner's pick with the bot id", async () => {
    const f = stub([[200, view(false)]]);
    expect(await viewForPick("https://w", auth, "7", true)).toEqual({ view: view(false).view, userUp: true, locked: false });
    expect(bodies(f)).toEqual([{ botId: "7", userUp: true }]);
  });

  it("keeps the stored pick when the worker says PICK_LOCKED", async () => {
    const f = stub([[409, locked], [200, view(true)]]);
    expect(await viewForPick("https://w", auth, "7", true)).toEqual({ view: view(true).view, userUp: false, locked: true });
    expect(bodies(f)).toEqual([{ botId: "7", userUp: true }, { botId: "7", userUp: false }]);
  });

  it("passes other refusals on", async () => {
    stub([[409, { ok: false, error: { code: "CLOSED", message: "Today's call closed at 20:00. Back tomorrow." } }]]);
    await expect(viewForPick("https://w", auth, "7", true)).rejects.toMatchObject({ code: "CLOSED" });
  });
});

const h = (b: string) => `0x${b.repeat(32)}`;
const ist = (t: string) => new Date(`${t}+05:30`).getTime();

const config = {
  bot_id: "7",
  version: 2,
  season: 3,
  rules: "Careful. Max 25% per coin.",
  max_per_coin_bps: 2500,
  max_trades_per_day: 4,
  from: { version: 1, rules: "Careful.", max_per_coin_bps: 4000, max_trades_per_day: 4 },
  changes: [{ what: "Max per coin 40% → 25%", because_correction_id: 12 }],
  proposed_by: { model: "m", prompt_version: "v2", prompt_hash: null },
  approve_by: "2026-11-27T03:00:00.000Z",
};
const ownerJson = (over: Record<string, unknown> = {}) => ({
  ok: true,
  bots: [
    {
      botId: "7",
      name: "AlphaWolf",
      status: "active",
      proposal: { version: 2, configHash: h("ab"), config, approveBy: config.approve_by },
      calls: { season: 3, you: 4, bot: 3, streak: 2, today: { userUp: true, botUp: false, priceAtCallE8: "1", callTx: h("01"), settleTx: null, userCorrect: null, botCorrect: null } },
      ...over,
    },
  ],
});

describe("parseOwner", () => {
  it("reads the worker's POST /owner answer", () => {
    const [bot] = parseOwner(ownerJson())!;
    expect(bot!.proposal!.config.from.max_per_coin_bps).toBe(4000);
    expect(bot!.calls).toMatchObject({ you: 4, bot: 3, streak: 2, today: { userUp: true, botUp: false, settleTx: null } });
  });

  it("rejects a proposal outside the registry's limits or for another version, so it can't be signed", () => {
    expect(parseOwner(ownerJson({ proposal: { version: 2, configHash: h("ab"), config: { ...config, max_per_coin_bps: 6000 }, approveBy: "x" } }))).toBeNull();
    expect(parseOwner(ownerJson({ proposal: { version: 3, configHash: h("ab"), config, approveBy: "x" } }))).toBeNull();
    expect(parseOwner(ownerJson({ proposal: { version: 2, configHash: "0x12", config, approveBy: "x" } }))).toBeNull();
  });

  it("takes a bot with no proposal and no call today", () => {
    expect(parseOwner(ownerJson({ proposal: null, calls: { season: null, you: 0, bot: 0, streak: 0, today: null } }))![0]!.proposal).toBeNull();
    expect(parseOwner({ ok: false })).toBeNull();
  });
});

describe("parseDailyCall / parseDailyView", () => {
  it("reads the state list and the signed view", () => {
    expect(parseDailyCall({ ok: true, day: 20418, closesAt: "2026-11-26T14:30:00.000Z", bots: [{ botId: "7", botName: "A", state: "joins_tomorrow" }] })).toEqual({
      day: 20418,
      closesAt: "2026-11-26T14:30:00.000Z",
      bots: [{ botId: "7", botName: "A", state: "joins_tomorrow" }],
    });
    expect(parseDailyCall({ ok: true, day: 1, closesAt: "x", bots: [{ botId: "7", botName: "A", state: "peek" }] })).toBeNull();
    expect(parseDailyView({ ok: true, view: { botId: "7", day: 20418, botUp: true, botSig: "0xabcd" } })).toEqual({ botId: "7", day: 20418, botUp: true, botSig: "0xabcd" });
    expect(parseDailyView({ ok: true, view: { botId: "7", day: 20418, botUp: "yes", botSig: "0xabcd" } })).toBeNull();
  });
});

describe("parseBigMoves", () => {
  const move = (order: Record<string, unknown> = {}) => ({
    ok: true,
    bigMoves: [
      {
        orderId: h("0e"),
        botId: "7",
        botName: "A",
        asset: "GOLD",
        side: "BUY",
        bps: 3500,
        deadline: "2026-11-26T06:00:00.000Z",
        reason: "Gold is calm.",
        signed: { order: { botId: "7", asset: 4, buy: true, bps: 3500, decisionId: h("0d"), actionIndex: 0, deadline: "1795000000", ...order }, runnerSig: "0x1234" },
      },
    ],
  });

  it("reads a pending move whose signed order matches the prompt", () => {
    expect(parseBigMoves(move())![0]).toMatchObject({ asset: "GOLD", side: "BUY", signed: { order: { asset: 4, decisionId: h("0d") } } });
  });

  it("rejects a signed order that says something else than the prompt", () => {
    expect(parseBigMoves(move({ asset: 0 }))).toBeNull();
    expect(parseBigMoves(move({ bps: 9000 }))).toBeNull();
    expect(parseBigMoves(move({ buy: false }))).toBeNull();
  });
});

describe("challenges", () => {
  const challenge = {
    code: h("c0"),
    season: 3,
    status: "open",
    challenger: { botId: "7", name: "GoldGuru", emoji: "g", ownerWallet: `0x${"a1".repeat(20)}` },
    opponent: null,
    createTx: h("01"),
    acceptTx: null,
    winnerBotId: null,
  };

  it("parses the worker's answer and builds the 8-byte share code", () => {
    expect(parseChallenge({ ok: true, challenge })).toEqual(challenge);
    expect(parseChallenge({ ok: true, challenge: { ...challenge, status: "won" } })).toBeNull();
    expect(shortCode(h("C0") as `0x${string}`)).toBe("c0".repeat(8));
  });

  it("maps the worker's statuses and never fetches a malformed code", async () => {
    const answer = (status: number, body: unknown = {}) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
    expect(await fetchChallenge("c0".repeat(8), "https://w", answer(200, { ok: true, challenge }))).toEqual({ kind: "ok", challenge });
    expect(await fetchChallenge("c0".repeat(8), "https://w", answer(404))).toEqual({ kind: "not_found" });
    expect(await fetchChallenge("c0".repeat(8), "https://w", answer(503))).toEqual({ kind: "not_live" });
    expect(await fetchChallenge("c0".repeat(8), null)).toEqual({ kind: "not_live" });
    expect(await fetchChallenge("../x", "https://w")).toEqual({ kind: "not_found" });
  });
});

describe("slot clock", () => {
  it("finds the next 09/13/17/21 IST slot, rolling over midnight", () => {
    expect(nextSlot(ist("2026-11-26T08:59:00"))).toEqual(new Date(ist("2026-11-26T09:00:00")));
    expect(nextSlot(ist("2026-11-26T09:00:00"))).toEqual(new Date(ist("2026-11-26T13:00:00")));
    expect(nextSlot(ist("2026-11-26T21:00:01"))).toEqual(new Date(ist("2026-11-27T09:00:00")));
    expect(nextSlot(ist("2026-11-26T23:59:00"))).toEqual(new Date(ist("2026-11-27T09:00:00")));
  });

  it("formats the countdown", () => {
    expect(countdown(2 * 3_600_000 + 14 * 60_000 + 5_000)).toBe("2h 14m");
    expect(countdown(9 * 60_000)).toBe("9m");
    expect(countdown(10_000)).toBe("<1m");
  });
});
