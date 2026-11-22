import { QIE_CHAIN_ID } from "@botfolio/shared";
import { keccak256, type Address, type Hex, type LocalAccount } from "viem";
import { InternalFailure, errorLabel, type Log } from "../auth/log";
import { broadcast } from "./broadcast";
import { RelayRefusal } from "./errors";
import { FeeSource, bumpFees, type Fees } from "./fees";
import { MIN_SECONDS_LEFT } from "./policy";
import type { RelayOutcome, RelaySender, Reservation, SendJob } from "./ports";
import { ExecutionFailed, RpcUnavailable, isQuantity, type RelayRpc } from "./rpc";

interface SignedTx {
  raw: Hex;
  hash: Hex;
  fees: Fees;
}

/** Everything we have signed and may have broadcast for one nonce. Only one of it can ever land. */
interface NonceSlot {
  nonce: number;
  /** The user's forwarder.execute. Absent for a gap left by an earlier process. */
  call?: SignedTx & { reservation: Reservation };
  /** No-op replacements, oldest first. */
  cancels: SignedTx[];
  consumedSince?: number;
}

export interface OpenRelay {
  txHash: Hex;
  reservation: Reservation;
}

export interface NonceManagerOptions {
  rpc: RelayRpc;
  account: LocalAccount;
  log: Log;
  /** Rows a previous process left `submitted` (relay_log). */
  openRelays?: () => Promise<OpenRelay[]>;
  /** Throws while relay_log is unreachable. DB down = nothing is broadcast, rebroadcasts and cancels included. */
  assertStore?: () => Promise<void>;
  now?: () => number;
}

const TICK_MS = 2_000;
/** Enough for the 50-parallel requirement, few enough that the wallet's fee exposure stays small. */
export const MAX_PENDING = 128;
/** Give up waiting in line before the app's 30 s timeout does. */
export const MAX_QUEUE_MS = 20_000;
export const REBROADCAST_AFTER_MS = 10_000;
export const CANCEL_AFTER_MS = 60_000;
const CANCEL_RETRY_MS = 30_000;
const OUTCOME_GIVE_UP_MS = 10 * 60_000;
const RESTART_LOOKBACK_MS = 60 * 60_000;
const REBROADCAST_BATCH = 16;
/** Per tick, so a backlog from before a restart can't hold up the nonce watcher. */
const INHERITED_BATCH = 16;
const CANCEL_GAS = 21_000n;

/**
 * The relayer wallet's one sender (SPEC §10: one Render instance, one nonce manager).
 *
 * - Nonces are handed out under a lock held through sign → store hash → broadcast, so parallel relays can't
 *   collide and reach the node in order.
 * - A tx that certainly wasn't sent gives its nonce to the next relay, so a failed send can't wedge the queue.
 * - A tx that MAY have been sent keeps its nonce. It is only ever re-sent as the same bytes, never signed again
 *   under another nonce, so it can't execute twice.
 * - If the lowest open nonce won't mine, the same bytes go out again after 10 s. After 60 s a 0-value self-send
 *   at that nonce with higher fees competes with it. One of the two lands and the queue moves.
 * - The hash is stored before broadcast, and the watcher checks the DB before it re-sends or cancels, so if the
 *   DB is down nothing is sent.
 */
export class NonceManager implements RelaySender {
  private readonly rpc: RelayRpc;
  private readonly account: LocalAccount;
  private readonly address: Address;
  private readonly log: Log;
  private readonly now: () => number;
  private readonly fees: FeeSource;
  private readonly assertStore: () => Promise<void>;

  private lock: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private next: number | undefined;
  private readonly slots = new Map<number, NonceSlot>();

  private chainChecked = false;
  private stopped = false;
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;
  private mined: number | undefined;
  private stuck: { nonce: number; since: number; resentAt: number; cancelledAt: number } | undefined;
  private loadOpenRelays: (() => Promise<OpenRelay[]>) | undefined;
  private inherited: (OpenRelay & { since: number })[] = [];

  constructor(opts: NonceManagerOptions) {
    this.rpc = opts.rpc;
    this.account = opts.account;
    this.address = opts.account.address;
    this.log = opts.log;
    this.now = opts.now ?? Date.now;
    this.fees = new FeeSource(opts.rpc, this.now);
    this.loadOpenRelays = opts.openRelays;
    this.assertStore = opts.assertStore ?? (async () => {});
  }

  start(): void {
    this.timer ??= setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    void this.tick();
  }

  /** Lets a send that has started finish. Anything still queued is refused unsent. */
  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
    await this.lock;
  }

  async send(job: SendJob): Promise<{ txHash: Hex }> {
    if (this.waiting + this.slots.size >= MAX_PENDING) throw new RelayRefusal("RATE_LIMITED_GLOBAL", { retryAfterSeconds: 5 });
    const queuedAt = this.now();
    this.waiting++;
    try {
      return await this.exclusive(() => this.signAndBroadcast(job, queuedAt));
    } catch (error) {
      // Only reads throw this, and every read comes before the broadcast.
      if (error instanceof RpcUnavailable || error instanceof ExecutionFailed) throw new RelayRefusal("RPC_UNAVAILABLE");
      throw error;
    } finally {
      this.waiting--;
    }
  }

  /** Everything that throws in here does so before anything could have been accepted by a node. */
  private async signAndBroadcast(job: SendJob, queuedAt: number): Promise<{ txHash: Hex }> {
    if (this.stopped) throw new RelayRefusal("RELAY_DISABLED");
    const now = this.now();
    if (now - queuedAt > MAX_QUEUE_MS) throw new RelayRefusal("RATE_LIMITED_GLOBAL", { retryAfterSeconds: 5 });
    if (job.deadline < now / 1000 + MIN_SECONDS_LEFT) throw new RelayRefusal("DEADLINE_EXPIRED");

    await this.checkChain();
    const fees = await this.fees.current();

    for (let attempt = 0; ; attempt++) {
      const nonce = await this.nextNonce();
      const tx = await this.sign({ nonce, to: job.to, data: job.data, gas: job.gas, fees });
      await job.reservation.recordSigned(tx.hash); // write-ahead: if this fails, nothing is sent

      let result = await broadcast(this.rpc, tx.raw, tx.hash, () => this.rawBelow(nonce));
      // "Nonce used" can also mean a node already took this very tx. Make sure before signing again.
      if (result === "nonce_used" && (await this.mightExist(tx.hash))) result = "maybe";

      if (result === "accepted" || result === "maybe") {
        this.slots.set(nonce, { nonce, call: { ...tx, reservation: job.reservation }, cancels: [] });
        this.next = nonce + 1;
        this.mined = undefined; // wakes the watcher
        if (result === "maybe") this.log("relay.broadcast_unclear", { relayId: job.reservation.id, txHash: tx.hash, nonce });
        return { txHash: tx.hash };
      }
      if (result === "rejected") throw new InternalFailure("broadcast_rejected");

      this.next = undefined;
      if (attempt > 0 || (await this.nextNonce()) <= nonce) throw new InternalFailure("broadcast_nonce_used");
    }
  }

  private async checkChain(): Promise<void> {
    if (this.chainChecked) return;
    const id = await this.rpc.read("eth_chainId", [], isQuantity);
    if (Number(id) !== QIE_CHAIN_ID) throw new InternalFailure("wrong_chain");
    this.chainChecked = true;
  }

  /**
   * Local once known. A re-read never goes below what we've handed out: a lagging node's pending count would
   * otherwise replace someone's queued relay.
   */
  private async nextNonce(): Promise<number> {
    if (this.next === undefined) {
      const pending = Number(await this.rpc.read("eth_getTransactionCount", [this.address, "pending"], isQuantity));
      this.next = Math.max(pending, ...[...this.slots.keys()].map((n) => n + 1));
    }
    return this.next;
  }

  private async sign(tx: { nonce: number; to: Address; data: Hex; gas: bigint; fees: Fees }): Promise<SignedTx> {
    const { fees, ...rest } = tx;
    const raw = await this.account.signTransaction({ ...rest, ...fees, type: "eip1559", chainId: QIE_CHAIN_ID, value: 0n });
    return { raw, hash: keccak256(raw), fees };
  }

  private async mightExist(hash: Hex): Promise<boolean> {
    try {
      return (await this.rpc.read("eth_getTransactionByHash", [hash], isObjectOrNull)) !== null;
    } catch {
      return true; // can't tell
    }
  }

  private rawBelow(nonce: number): Hex[] {
    return [...this.slots.values()]
      .filter((slot) => slot.nonce < nonce)
      .sort((a, b) => a.nonce - b.nonce)
      .flatMap((slot) => latestTx(slot)?.raw ?? []);
  }

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.lock.then(run);
    this.lock = result.catch(() => undefined);
    return result;
  }

  // --- watcher: outcomes, rebroadcast, cancel ---

  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      await this.adoptOpenRelays();
      await this.settleInherited();
      await this.watchNonces();
    } catch (error) {
      this.log("relay.watch_failed", { cause: errorLabel(error) });
    } finally {
      this.ticking = false;
    }
  }

  private async adoptOpenRelays(): Promise<void> {
    if (!this.loadOpenRelays) return;
    try {
      const open = await this.loadOpenRelays();
      this.loadOpenRelays = undefined;
      const ours = new Set([...this.slots.values()].map((slot) => slot.call?.hash));
      this.inherited = open.filter((o) => !ours.has(o.txHash)).map((o) => ({ ...o, since: this.now() }));
    } catch (error) {
      this.log("relay.open_rows_unreadable", { cause: errorLabel(error) }); // retried next tick
    }
  }

  private async settleInherited(): Promise<void> {
    // Take from the front and put the unresolved ones back at the end, so every row gets its turn.
    for (const open of this.inherited.slice(0, INHERITED_BATCH)) {
      const receipt = await this.receipt(open.txHash);
      this.inherited.splice(this.inherited.indexOf(open), 1);
      const done = receipt
        ? await this.saveOutcome(open.reservation, receipt.outcome, receipt.gasUsed, open.txHash)
        : this.now() - open.since >= RESTART_LOOKBACK_MS;
      if (!done) this.inherited.push(open);
    }
  }

  private async watchNonces(): Promise<void> {
    if (this.next === undefined) await this.exclusive(() => this.nextNonce()); // after a restart: is there a gap?
    if (this.slots.size === 0 && this.mined !== undefined && this.next !== undefined && this.mined >= this.next) return;

    const mined = Number(await this.rpc.read("eth_getTransactionCount", [this.address, "latest"], isQuantity));
    this.mined = mined;
    for (const slot of [...this.slots.values()]) if (slot.nonce < mined) await this.settle(slot);
    await this.unstick(mined);
  }

  private async settle(slot: NonceSlot): Promise<void> {
    const candidates = [...(slot.call ? [slot.call] : []), ...slot.cancels];
    for (const tx of candidates) {
      const receipt = await this.receipt(tx.hash);
      if (!receipt) continue;
      const outcome = tx === slot.call ? receipt.outcome : "cancelled";
      if (slot.call && !(await this.saveOutcome(slot.call.reservation, outcome, receipt.gasUsed, tx.hash))) return;
      this.slots.delete(slot.nonce);
      return;
    }
    slot.consumedSince ??= this.now();
    if (this.now() - slot.consumedSince > OUTCOME_GIVE_UP_MS) {
      // The row stays `submitted`: it counts toward the limits and never as a confirmed user tx.
      this.log("relay.outcome_unknown", { relayId: slot.call?.reservation.id, nonce: slot.nonce });
      this.slots.delete(slot.nonce);
    }
  }

  private async unstick(head: number): Promise<void> {
    if (this.next === undefined || head >= this.next) {
      this.stuck = undefined;
      return;
    }
    const now = this.now();
    if (this.stuck?.nonce !== head) {
      this.stuck = { nonce: head, since: now, resentAt: now, cancelledAt: 0 };
      return;
    }
    const cancelDue = now - this.stuck.since >= CANCEL_AFTER_MS && now - this.stuck.cancelledAt >= CANCEL_RETRY_MS;
    if (!cancelDue && now - this.stuck.resentAt < REBROADCAST_AFTER_MS) return;
    await this.assertStore();
    if (cancelDue) {
      this.stuck.cancelledAt = now;
      this.stuck.resentAt = now;
      // Under the lock, so it can't race a send that has just re-read the nonce.
      await this.exclusive(() => this.cancel(head));
    } else {
      this.stuck.resentAt = now;
      await this.rebroadcastFrom(head);
    }
  }

  private async rebroadcastFrom(head: number): Promise<void> {
    for (let nonce = head; nonce < head + REBROADCAST_BATCH; nonce++) {
      const slot = this.slots.get(nonce);
      const tx = slot && latestTx(slot);
      if (!tx || (await broadcast(this.rpc, tx.raw, tx.hash)) === "maybe") return;
    }
  }

  private async cancel(nonce: number): Promise<void> {
    if (this.stopped) return;
    await this.checkChain();
    const slot = this.slots.get(nonce) ?? { nonce, cancels: [] };
    const current = await this.fees.current();
    const fees = bumpFees(latestTx(slot)?.fees ?? current, current);
    if (!fees) {
      this.log("relay.nonce_stuck_at_fee_cap", { nonce });
      return this.rebroadcastFrom(nonce);
    }
    const tx = await this.sign({ nonce, to: this.address, data: "0x", gas: CANCEL_GAS, fees });
    slot.cancels.push(tx);
    this.slots.set(nonce, slot);
    const result = await broadcast(this.rpc, tx.raw, tx.hash);
    this.log("relay.cancel_sent", { nonce, txHash: tx.hash, result, relayId: slot.call?.reservation.id });
  }

  private async receipt(hash: Hex): Promise<{ outcome: "confirmed" | "reverted"; gasUsed: bigint | null } | null> {
    const receipt = await this.rpc.read("eth_getTransactionReceipt", [hash], isObjectOrNull);
    if (receipt?.status !== "0x1" && receipt?.status !== "0x0") return null;
    return {
      outcome: receipt.status === "0x1" ? "confirmed" : "reverted",
      gasUsed: isQuantity(receipt.gasUsed) ? BigInt(receipt.gasUsed) : null,
    };
  }

  private async saveOutcome(reservation: Reservation, outcome: RelayOutcome, gasUsed: bigint | null, hash: Hex) {
    try {
      await reservation.recordOutcome(outcome, gasUsed, hash);
      this.log("relay.outcome", { relayId: reservation.id, outcome, txHash: hash });
      return true;
    } catch (error) {
      this.log("relay.outcome_write_failed", { relayId: reservation.id, cause: errorLabel(error) }); // retried
      return false;
    }
  }
}

const latestTx = (slot: NonceSlot): SignedTx | undefined => slot.cancels[slot.cancels.length - 1] ?? slot.call;

const isObjectOrNull = (v: unknown): v is Record<string, unknown> | null =>
  v === null || (typeof v === "object" && !Array.isArray(v));
