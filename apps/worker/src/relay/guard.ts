import type { Hex } from "viem";
import { InternalFailure } from "../auth/log";
import { Throttle } from "../auth/throttle";
import type { Db } from "./db";
import { RelayRefusal } from "./errors";
import { NewBotIpLimit } from "./ip-limit";
import type { RelayRateLimits } from "./limits";
import type { RelayAttempt, RelayGuard, RelayOutcome, Reservation } from "./ports";

/** Any constant. Every reservation takes this lock, so the count and the insert are one atomic step. */
export const RESERVE_LOCK_KEY = 19_900_039;

/**
 * A wallet has one relay in flight. Two copies of a signed request would both pass the pre-checks, and the
 * second would revert at our cost, because the forwarder nonce only moves when the first is mined.
 * After 11 min the 10-min deadline has passed, so a row that is still open can't block any longer.
 */
const IN_FLIGHT_MINUTES = 11;
const IN_FLIGHT_RETRY_SECONDS = 5;

// Flood protection, separate from the §11 limits: bounds RPC and DB work from attempts that never broadcast.
const ATTEMPTS_PER_WALLET_PER_MINUTE = 20;
const ATTEMPTS_PER_IP_PER_MINUTE = 300;
const LOGGED_REFUSALS_PER_WALLET_PER_MINUTE = 20;

/**
 * What counts toward 30/wallet/day and 2000/h: rows that were or may have been broadcast (submitted, confirmed,
 * reverted), over rolling windows. Refusals don't: otherwise someone already over a limit stays locked out by
 * retrying, and one wallet could use up the global limit with junk (open question in #219).
 */
const USAGE_SQL = `
  with wallet as (
    select count(*)::int as n, min(created_at) as oldest from relay_log
    where user_wallet = $1 and status <> 'rejected' and created_at > now() - interval '24 hours'
  ), everyone as (
    select count(*)::int as n, min(created_at) as oldest from relay_log
    where status <> 'rejected' and created_at > now() - interval '1 hour'
  )
  select
    wallet.n as wallet_count,
    ceil(extract(epoch from wallet.oldest + interval '24 hours' - now()))::int as wallet_retry,
    everyone.n as global_count,
    ceil(extract(epoch from everyone.oldest + interval '1 hour' - now()))::int as global_retry,
    exists (
      select 1 from relay_log
      where user_wallet = $1 and status = 'submitted'
        and created_at > now() - interval '${IN_FLIGHT_MINUTES} minutes'
    ) as in_flight
  from wallet, everyone`;

interface Usage {
  wallet_count: number;
  wallet_retry: number | null;
  global_count: number;
  global_retry: number | null;
  in_flight: boolean;
}

/** `cancelled` is our no-op tx, so it's `rejected`: site_activity_stats counts every confirmed row as a user's. */
const STATUS: Record<RelayOutcome, "confirmed" | "reverted" | "rejected"> = {
  confirmed: "confirmed",
  reverted: "reverted",
  cancelled: "rejected",
};

/**
 * relay_log + rate limits (SPEC §11, #39). The log names only wallets that proved they are request.from.
 * Reserving inserts the row as `submitted` with no hash, so a crash counts against the limit, not for it.
 */
export class PgRelayGuard implements RelayGuard {
  private readonly ipLimit: NewBotIpLimit;
  private readonly walletAttempts: Throttle;
  private readonly ipAttempts: Throttle;
  private readonly refusalWrites: Throttle;

  constructor(
    private readonly db: Db,
    private readonly limits: RelayRateLimits,
    now: () => number = Date.now,
  ) {
    this.ipLimit = new NewBotIpLimit(limits.newBotsPerIpPerDay, now);
    this.walletAttempts = new Throttle(ATTEMPTS_PER_WALLET_PER_MINUTE, 60_000, 50_000, now);
    this.ipAttempts = new Throttle(ATTEMPTS_PER_IP_PER_MINUTE, 60_000, 50_000, now);
    this.refusalWrites = new Throttle(LOGGED_REFUSALS_PER_WALLET_PER_MINUTE, 60_000, 50_000, now);
  }

  async reserve(attempt: RelayAttempt): Promise<Reservation> {
    const { wallet, target, selector, action, ip } = attempt;
    let wait = this.walletAttempts.take(wallet);
    if (wait !== null) {
      throw new RelayRefusal("RATE_LIMITED_USER", {
        retryAfterSeconds: wait,
        message: "Too many tries. Wait a minute and try again.",
      });
    }
    wait = this.ipAttempts.take(ip);
    if (wait !== null) {
      throw new RelayRefusal("RATE_LIMITED_IP", {
        retryAfterSeconds: wait,
        message: "Too many tries from this connection. Wait a minute and try again.",
      });
    }

    let ipSlot: { release: () => void } | undefined;
    try {
      const id = await this.db.transaction(async (tx) => {
        await tx.query("set local lock_timeout = '4s'");
        await tx.query("select pg_advisory_xact_lock($1)", [RESERVE_LOCK_KEY]);
        // Read committed: this statement's snapshot is taken after the lock, so it sees the previous holder's row.
        const usage = (await tx.query<Usage>(USAGE_SQL, [wallet])).rows[0];
        if (!usage) throw new InternalFailure("usage_query_empty");

        if (usage.in_flight) {
          throw new RelayRefusal("RATE_LIMITED_USER", {
            retryAfterSeconds: IN_FLIGHT_RETRY_SECONDS,
            message: "Your last action is still being confirmed. Try again in a few seconds.",
          });
        }
        if (usage.wallet_count >= this.limits.perWalletPerDay) {
          throw new RelayRefusal("RATE_LIMITED_USER", { retryAfterSeconds: Math.max(1, usage.wallet_retry ?? 1) });
        }
        if (action?.contract === "BotRegistry" && action.fn === "createBot") {
          const slot = this.ipLimit.tryReserve(ip);
          if ("retryAfterSeconds" in slot) {
            throw new RelayRefusal("RATE_LIMITED_IP", { retryAfterSeconds: slot.retryAfterSeconds });
          }
          ipSlot = slot;
        }
        if (usage.global_count >= this.limits.perHourGlobal) {
          throw new RelayRefusal("RATE_LIMITED_GLOBAL", { retryAfterSeconds: Math.max(1, usage.global_retry ?? 1) });
        }

        const inserted = await tx.query<{ id: string }>(
          "insert into relay_log (user_wallet, target, selector, status) values ($1, $2, $3, 'submitted') returning id::text as id",
          [wallet, target, selector],
        );
        if (!inserted.rows[0]) throw new InternalFailure("reservation_not_inserted");
        return inserted.rows[0].id;
      });
      return this.reservation(id, ipSlot);
    } catch (error) {
      ipSlot?.release();
      throw error;
    }
  }

  async recordRefusal({ wallet, target, selector }: RelayAttempt): Promise<void> {
    if (this.refusalWrites.take(wallet) !== null) return;
    await this.db.query("insert into relay_log (user_wallet, target, selector, status) values ($1, $2, $3, 'rejected')", [
      wallet,
      target,
      selector,
    ]);
  }

  /** Rows a previous process broadcast but didn't see mined, so their outcome can still be recorded. */
  async openRelays(): Promise<{ txHash: Hex; reservation: Reservation }[]> {
    const { rows } = await this.db.query<{ id: string; tx_hash: Hex }>(
      `select id::text as id, tx_hash from relay_log
       where status = 'submitted' and tx_hash is not null and created_at > now() - interval '1 hour'
       order by id limit 500`,
    );
    return rows.map((row) => ({ txHash: row.tx_hash, reservation: this.reservation(row.id) }));
  }

  private reservation(id: string, ipSlot?: { release: () => void }): Reservation {
    return {
      id,
      recordSigned: async (txHash) => {
        const { rows } = await this.db.query(
          "update relay_log set tx_hash = $2 where id = $1 and status = 'submitted' returning id",
          [id, txHash],
        );
        if (rows.length !== 1) throw new InternalFailure("reservation_lost");
      },
      recordOutcome: async (outcome, gasUsed, txHash) => {
        await this.db.query(
          "update relay_log set status = $2, gas_used = $3, tx_hash = $4 where id = $1 and status = 'submitted'",
          [id, STATUS[outcome], gasUsed?.toString() ?? null, txHash],
        );
      },
      release: async () => {
        ipSlot?.release();
        await this.db.query("update relay_log set status = 'rejected', tx_hash = null where id = $1 and status = 'submitted'", [id]);
      },
    };
  }
}
