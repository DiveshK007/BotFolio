import { describe, expect, it, vi } from "vitest";
import { parseTransaction, type Hex, type LocalAccount } from "viem";
import { classifySend } from "../../src/relay/broadcast";
import { MAX_FEE_PER_GAS, bumpFees } from "../../src/relay/fees";
import {
  CANCEL_AFTER_MS,
  MAX_PENDING,
  MAX_QUEUE_MS,
  NonceManager,
  REBROADCAST_AFTER_MS,
  type OpenRelay,
} from "../../src/relay/nonce-manager";
import type { SendJob } from "../../src/relay/ports";
import { RelayRpc } from "../../src/relay/rpc";
import { FORWARDER, NOW_S, RELAYER, TX_HASH, fakeReservation } from "./helpers/fakes";
import { fakeChain } from "./helpers/fake-chain";
import { fakeNode } from "./helpers/http";

type ChainOptions = NonNullable<Parameters<typeof fakeChain>[0]>;

async function setup(options: ChainOptions & { openRelays?: () => Promise<OpenRelay[]>; extraUrls?: string[] } = {}) {
  const chain = await fakeChain(options);
  let time = NOW_S * 1000;
  const log = vi.fn();
  const manager = new NonceManager({
    rpc: new RelayRpc([chain.url, ...(options.extraUrls ?? [])]),
    account: RELAYER as LocalAccount,
    log,
    now: () => time,
    openRelays: options.openRelays,
  });

  let n = 0;
  function job(over: Partial<SendJob> = {}) {
    const reservation = fakeReservation(String(++n));
    const data = `0x${n.toString(16).padStart(8, "0")}` as Hex;
    const send = () =>
      manager.send({ to: FORWARDER, data, gas: 200_000n, deadline: Math.floor(time / 1000) + 300, reservation, ...over });
    return { reservation, data, send };
  }

  const advance = (ms: number) => (time += ms);
  /** Where each distinct signed tx that carried this call was put. */
  const noncesOf = (data: Hex) => {
    const byHash = new Map(chain.state.sent.map((tx) => [tx.hash, parseTransaction(tx.raw)]));
    return [...byHash.values()].filter((tx) => tx.data === data).map((tx) => tx.nonce ?? 0);
  };
  return { chain, manager, log, job, advance, noncesOf };
}

describe("nonce manager: no collisions (#40)", () => {
  it.each([
    ["a node that refuses gaps", true],
    ["a node that queues gaps", false],
  ])("50 parallel relays get 50 consecutive nonces on %s", async (_name, strict) => {
    const t = await setup({ strict, startNonce: 7 });
    const jobs = Array.from({ length: 50 }, () => t.job());
    const sent = await Promise.all(jobs.map((j) => j.send()));

    expect(new Set(sent.map((s) => s.txHash)).size).toBe(50);
    expect(t.chain.state.sent.map((tx) => tx.nonce)).toEqual(Array.from({ length: 50 }, (_, i) => 7 + i));

    t.chain.mine();
    await t.manager.tick();
    for (const j of jobs) expect(j.reservation.recordOutcome).toHaveBeenCalledWith("confirmed", 123_456n, expect.any(String));
  });

  it("starts after txs already pending from before a restart", async () => {
    const t = await setup({ startNonce: 3 });
    const before = t.job();
    await before.send();
    const second = new NonceManager({ rpc: new RelayRpc([t.chain.url]), account: RELAYER as LocalAccount, log: vi.fn() });
    const deadline = Math.floor(Date.now() / 1000) + 300;
    await second.send({ to: FORWARDER, data: "0xff", gas: 100_000n, deadline, reservation: fakeReservation() });
    expect(t.chain.state.sent.map((tx) => tx.nonce)).toEqual([3, 4]);
  });

  it("signs for chain 1990 with no value", async () => {
    const t = await setup();
    await t.job().send();
    const tx = parseTransaction(t.chain.state.sent[0]!.raw);
    expect(tx.chainId).toBe(1990);
    expect(tx.value ?? 0n).toBe(0n);
    expect(tx.maxFeePerGas).toBe(2_250_000_000n);
  });
});

describe("nonce manager: a failed send can't wedge it (#40)", () => {
  it.each(["insufficient funds for gas * price + value", "insufficient fee", "max fee per gas less than block base fee"])(
    "reuses the nonce after '%s'",
    async (refuse) => {
      const t = await setup({ strict: true });
      t.chain.state.behaviours.push({ refuse });
      const failed = t.job();
      const next = t.job();
      const results = await Promise.allSettled([failed.send(), next.send()]);
      expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled"]);
      expect(t.chain.state.sent.map((tx) => tx.nonce)).toEqual([0, 0]);
      expect(t.chain.pending()).toBe(1);
    },
  );

  it("sends nothing when the hash can't be stored, then carries on", async () => {
    const t = await setup({ strict: true });
    const failed = t.job();
    failed.reservation.recordSigned.mockRejectedValue(new Error("db down"));
    await expect(failed.send()).rejects.toThrow();
    expect(t.chain.state.sent).toHaveLength(0);
    await t.job().send();
    expect(t.chain.state.sent.map((tx) => tx.nonce)).toEqual([0]);
  });

  it("stores the hash before it broadcasts", async () => {
    const t = await setup();
    const j = t.job();
    let sentWhenStored = -1;
    j.reservation.recordSigned.mockImplementation(async () => {
      sentWhenStored = t.chain.state.sent.length;
    });
    const { txHash } = await j.send();
    expect(sentWhenStored).toBe(0);
    expect(j.reservation.recordSigned).toHaveBeenCalledWith(txHash);
  });

  it("moves on when another tx took the nonce", async () => {
    const t = await setup({ strict: true });
    await t.job().send();
    t.chain.mine();
    await t.manager.tick();
    t.chain.state.mined = 5; // the key was used elsewhere
    const j = t.job();
    await j.send();
    expect(t.chain.state.sent.at(-1)!.nonce).toBe(5);
    expect(j.reservation.recordSigned).toHaveBeenCalledTimes(2);
  });

  it.each(["eth_chainId", "eth_gasPrice", "eth_getTransactionCount"])("broadcasts nothing when %s fails", async (method) => {
    const t = await setup();
    t.chain.state.failing.add(method);
    await expect(t.job().send()).rejects.toMatchObject({ code: "RPC_UNAVAILABLE" });
    expect(t.chain.state.sent).toHaveLength(0);
  });

  it("broadcasts nothing on another chain", async () => {
    const t = await setup({ chainId: 1 });
    await expect(t.job().send()).rejects.toMatchObject({ reason: "wrong_chain" });
    expect(t.chain.state.sent).toHaveLength(0);
  });

  it("refuses a gas price over the cap, so a bad RPC can't drain the wallet", async () => {
    const t = await setup();
    t.chain.state.gasPrice = MAX_FEE_PER_GAS + 1n;
    await expect(t.job().send()).rejects.toMatchObject({ reason: "gas_price_above_cap" });
    expect(t.chain.state.sent).toHaveLength(0);
  });

  it("won't send a request that expired while it waited", async () => {
    const t = await setup();
    await expect(t.job({ deadline: NOW_S + 2 }).send()).rejects.toMatchObject({ code: "DEADLINE_EXPIRED" });
    expect(t.chain.state.sent).toHaveLength(0);
  });

  it("gives up in line rather than answer after the app stopped waiting", async () => {
    const t = await setup();
    const slow = t.job();
    slow.reservation.recordSigned.mockImplementation(async () => void t.advance(MAX_QUEUE_MS + 1));
    const first = slow.send();
    await expect(t.job().send()).rejects.toMatchObject({ code: "RATE_LIMITED_GLOBAL" });
    await first;
    expect(t.chain.state.sent).toHaveLength(1);
  });

  it("refuses beyond the pending cap", async () => {
    const t = await setup();
    const all = await Promise.allSettled(Array.from({ length: MAX_PENDING + 1 }, () => t.job().send()));
    expect(all.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(t.chain.state.sent).toHaveLength(MAX_PENDING);
  }, 20_000);

  it("sends nothing after stop", async () => {
    const t = await setup();
    await t.manager.stop();
    await expect(t.job().send()).rejects.toMatchObject({ code: "RELAY_DISABLED" });
    expect(t.chain.state.sent).toHaveLength(0);
  });
});

describe("nonce manager: an unclear broadcast can't double send (#40)", () => {
  it("keeps the nonce when the node took it but the answer was lost", async () => {
    const t = await setup({ strict: true });
    t.chain.state.behaviours.push("accept_then_drop");
    const lost = t.job();
    const { txHash } = await lost.send();
    await t.job().send();
    expect(t.noncesOf(lost.data)).toEqual([0]);
    expect(t.chain.state.sent.map((tx) => tx.nonce)).toEqual([0, 1]);

    t.chain.mine();
    await t.manager.tick();
    expect(lost.reservation.recordOutcome).toHaveBeenCalledWith("confirmed", 123_456n, txHash);
    expect(lost.reservation.release).not.toHaveBeenCalled();
  });

  it("re-sends the same bytes when the node never got it", async () => {
    const t = await setup();
    t.chain.state.behaviours.push("drop");
    const j = t.job();
    const { txHash } = await j.send();
    await t.manager.tick();
    t.advance(REBROADCAST_AFTER_MS);
    await t.manager.tick();
    expect(t.chain.state.sent.map((tx) => tx.hash)).toEqual([txHash, txHash]);
    expect(t.noncesOf(j.data)).toEqual([0]);
  });

  it("hands a node the earlier tx when it refuses a gap", async () => {
    const t = await setup({ strict: true });
    t.chain.state.behaviours.push("drop");
    const first = t.job();
    const second = t.job();
    await first.send();
    await second.send();
    expect(t.chain.pending()).toBe(2);
    expect(t.noncesOf(first.data)).toEqual([0]);
    expect(t.noncesOf(second.data)).toEqual([1]);
  });

  it("treats a refusal after an unclear answer as unclear", async () => {
    const refusing = await fakeNode(() => ({ error: { code: -32000, message: "insufficient funds" } }));
    const t = await setup({ extraUrls: [refusing.url] });
    t.chain.state.behaviours.push("accept_then_drop");
    const j = t.job();
    await expect(j.send()).resolves.toHaveProperty("txHash");
    await t.job().send();
    expect(t.noncesOf(j.data)).toEqual([0]);
  });

  it("treats 'nonce too low' about our own tx as sent", async () => {
    const usedUp = await fakeNode((method) =>
      method === "eth_sendRawTransaction"
        ? { error: { code: -32000, message: "nonce too low" } }
        : { error: { code: -32601, message: "method not found" } },
    );
    const t = await setup({ extraUrls: [usedUp.url] });
    t.chain.state.behaviours.push("accept_then_drop");
    const j = t.job();
    await j.send();
    expect(j.reservation.recordSigned).toHaveBeenCalledOnce();
  });

  it("doesn't sign again when 'nonce too low' hides that this very tx got in", async () => {
    const t = await setup();
    t.chain.state.behaviours.push("accept_then_nonce_used");
    const j = t.job();
    await j.send();
    expect(j.reservation.recordSigned).toHaveBeenCalledOnce();
    expect(t.noncesOf(j.data)).toEqual([0]);
  });

  it("doesn't sign again for an error it doesn't recognise", async () => {
    const t = await setup();
    t.chain.state.behaviours.push({ refuse: "some new node error" });
    const j = t.job();
    await expect(j.send()).resolves.toHaveProperty("txHash");
    await t.job().send();
    expect(t.noncesOf(j.data)).toEqual([0]);
    expect(t.chain.state.sent.map((tx) => tx.nonce)).toEqual([0, 1]);
  });
});

describe("nonce manager: watcher (#40)", () => {
  it("records a revert as reverted", async () => {
    const t = await setup();
    const j = t.job();
    await j.send();
    t.chain.mine("0x0");
    await t.manager.tick();
    expect(j.reservation.recordOutcome).toHaveBeenCalledWith("reverted", 123_456n, expect.any(String));
  });

  it("retries an outcome write that failed", async () => {
    const t = await setup();
    const j = t.job();
    await j.send();
    j.reservation.recordOutcome.mockRejectedValueOnce(new Error("db down"));
    t.chain.mine();
    await t.manager.tick();
    await t.manager.tick();
    expect(j.reservation.recordOutcome).toHaveBeenCalledTimes(2);
  });

  it("cancels a stuck head with a no-op, and never counts it as confirmed", async () => {
    const t = await setup();
    const stuck = t.job();
    const behind = t.job();
    const { txHash } = await stuck.send();
    await behind.send();
    t.chain.state.unminable.add(txHash);

    t.chain.mine();
    await t.manager.tick();
    t.advance(CANCEL_AFTER_MS);
    await t.manager.tick();

    const cancel = parseTransaction(t.chain.state.sent.at(-1)!.raw);
    expect(cancel.nonce ?? 0).toBe(0);
    expect(cancel.to?.toLowerCase()).toBe(RELAYER.address.toLowerCase());
    expect(cancel.value ?? 0n).toBe(0n);
    expect(cancel.data ?? "0x").toBe("0x");

    t.chain.mine();
    await t.manager.tick();
    expect(stuck.reservation.recordOutcome).toHaveBeenCalledExactlyOnceWith("cancelled", 123_456n, expect.any(String));
    expect(behind.reservation.recordOutcome).toHaveBeenCalledWith("confirmed", 123_456n, expect.any(String));
    expect(t.noncesOf(stuck.data)).toEqual([0]);
  });

  it("records the original if it beats its cancel", async () => {
    const t = await setup();
    const j = t.job();
    const { txHash } = await j.send();
    await t.manager.tick();
    t.advance(CANCEL_AFTER_MS);
    t.chain.state.behaviours.push({ refuse: "replacement transaction underpriced" });
    await t.manager.tick();
    t.chain.mine();
    await t.manager.tick();
    expect(j.reservation.recordOutcome).toHaveBeenCalledExactlyOnceWith("confirmed", 123_456n, txHash);
  });

  it("fills a mempool gap left by a forgetful node", async () => {
    const t = await setup({ strict: true });
    const jobs = [t.job(), t.job(), t.job()];
    for (const j of jobs) await j.send();
    t.chain.forget();
    await t.manager.tick();
    t.advance(REBROADCAST_AFTER_MS);
    await t.manager.tick();
    expect(t.chain.pending()).toBe(3);
    for (const j of jobs) expect(t.noncesOf(j.data)).toHaveLength(1);
  });

  it("after a restart, records the outcome of rows left open", async () => {
    const reservation = fakeReservation();
    const t = await setup({ openRelays: async () => [{ txHash: TX_HASH, reservation }] });
    t.chain.state.receipts.set(TX_HASH, { status: "0x1", gasUsed: "0x1e240" });
    await t.manager.tick();
    expect(reservation.recordOutcome).toHaveBeenCalledExactlyOnceWith("confirmed", 123_456n, TX_HASH);
  });

  it("retries loading open rows while the DB is down", async () => {
    const openRelays = vi.fn(async (): Promise<OpenRelay[]> => []);
    openRelays.mockRejectedValueOnce(new Error("db down"));
    const t = await setup({ openRelays });
    await t.manager.tick();
    await t.manager.tick();
    await t.manager.tick();
    expect(openRelays).toHaveBeenCalledTimes(2);
  });

  it("goes quiet when nothing is pending", async () => {
    const t = await setup();
    await t.manager.tick();
    const calls = t.chain.calls.length;
    await t.manager.tick();
    expect(t.chain.calls).toHaveLength(calls);
  });
});

describe("send classification", () => {
  const error = (message: string) => ({ kind: "error", code: -32000, message, data: undefined }) as const;

  it.each([
    ["already known", "accepted"],
    ["transaction already imported", "accepted"],
    ["tx already in mempool cache", "accepted"],
    ["nonce too low", "nonce_used"],
    ["invalid nonce; got 4, expected 5: invalid sequence", "nonce_used"],
    ["invalid nonce; got 6, expected 5: invalid sequence", "gap"],
    ["account sequence mismatch, expected 5, got 4", "nonce_used"],
    ["account sequence mismatch, expected 5, got 6", "gap"],
    ["replacement transaction underpriced", "nonce_used"],
    ["insufficient funds for gas * price + value", "rejected"],
    ["upstream timeout", "maybe"],
    ["internal error", "maybe"],
  ])("%s → %s", (message, verdict) => {
    expect(classifySend(error(message), TX_HASH)).toBe(verdict);
  });

  it("never treats silence or a wrong hash as a refusal", () => {
    expect(classifySend({ kind: "no_answer" }, TX_HASH)).toBe("maybe");
    expect(classifySend({ kind: "result", result: "0x1234" }, TX_HASH)).toBe("maybe");
  });

  it("never bumps past the fee cap", () => {
    let fees = { maxFeePerGas: 2_250_000_000n, maxPriorityFeePerGas: 125_000_000n };
    for (let i = 0; i < 30; i++) {
      const next = bumpFees(fees, fees);
      if (!next) break;
      expect(next.maxFeePerGas).toBeLessThanOrEqual(MAX_FEE_PER_GAS);
      expect(next.maxPriorityFeePerGas).toBeLessThanOrEqual(next.maxFeePerGas);
      expect(next.maxFeePerGas * 10n).toBeGreaterThan(fees.maxFeePerGas * 11n);
      fees = next;
    }
    expect(bumpFees(fees, fees)).toBeNull();
  });
});
