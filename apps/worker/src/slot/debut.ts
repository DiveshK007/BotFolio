import { saveOracleReads } from "../decisions/record";
import { personaDraft } from "../persona/drafts";
import { errorLabel } from "../scheduler/log";
import type { Slot } from "../scheduler/slots";
import { decideBot } from "./decide";
import { deliver } from "./deliver";
import type { RunnerDeps } from "./deps";
import { markPrices, saveMark } from "./marks";
import { eachBot, readMarket } from "./run";
import { decisionsOfSlot } from "./stored";

/**
 * #47: the debut fires within 10 s of BotCreated. The indexer can't do that (a 10 s loop, plus 2 confirmations),
 * so this polls `nextBotId` at the chain's head.
 */
export const POLL_MS = 2_000;
/** Older than this and it waits for its first slot: a debut hours late isn't one. */
export const DEBUT_WINDOW_MS = 10 * 60_000;
const MAX_TRIES = 3;
const NEW_BOTS_PER_TICK = 50;

export class DebutWatcher {
  private readonly tries = new Map<bigint, number>();
  /** Debut slots whose batch hasn't gone out yet. A restart inside the window finds them again in the DB. */
  private readonly unsent = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();
  private stopped = false;
  private resumed = false;
  private failureLogged = false;

  constructor(private readonly deps: RunnerDeps) {}

  start(): void {
    const loop = () => {
      this.running = this.safeTick().then(() => {
        if (!this.stopped) this.timer = setTimeout(loop, POLL_MS);
      });
    };
    loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private async safeTick(): Promise<void> {
    try {
      await this.tick();
      if (this.failureLogged) this.record();
      this.failureLogged = false;
    } catch (error) {
      // Every 2 s, so once per outage.
      if (!this.failureLogged) {
        this.deps.log.warn("debut.poll_failed", { error: errorLabel(error) });
        this.record("poll failed");
      }
      this.failureLogged = true;
    }
  }

  async tick(): Promise<void> {
    await this.deps.db.withLock("debut", async () => {
      await this.addNewBots();
      if (!this.resumed) await this.findUnsent();
      await this.resend();
      await eachBot(await this.waitingForDebut(), (botId) => this.debut(botId));
    });
  }

  /**
   * The pending `bots` row (SPEC §3: `created_tx` null until indexed), which decisions need. Name and text come
   * from the owner's persona draft, if its hash is the one on-chain. The indexer keeps them on that same condition.
   */
  private async addNewBots(): Promise<void> {
    const { db, chain } = this.deps;
    const next = await chain.nextBotId();
    if (next <= 1n) return;
    const { rows } = await db.query<{ id: string }>(
      `select g.id::text as id
       from generate_series(1::bigint, $1::bigint) as g(id)
       left join bots b on b.id = g.id
       where b.id is null
       order by g.id desc limit $2::int`,
      [(next - 1n).toString(), NEW_BOTS_PER_TICK],
    );
    for (const { id } of rows) {
      const bot = await chain.bot(BigInt(id));
      const draft = await personaDraft(db, bot.owner, bot.personaHash);
      await db.transaction(async (tx) => {
        await tx.query(
          `insert into bots (id, owner_wallet, name, emoji, persona_text, persona_hash, dna_seed, created_at, is_house)
           values ($1::bigint, $2::text, $3::text, $4::text, $5::text, decode($6::text, 'hex'), $9::text, $7::timestamptz, $8::boolean)
           on conflict (id) do nothing`,
          [id, bot.owner, draft?.name || `Bot #${id}`, draft?.emoji ?? "", draft?.persona ?? "", bot.personaHash.slice(2), bot.createdAt.toISOString(), bot.house, draft?.dnaSeed ?? null],
        );
        await tx.query(
          `insert into bot_versions
             (bot_id, version, rules_text, max_per_coin_bps, max_trades_per_day, config_json, config_hash, source)
           values ($1::bigint, 1, $2::text, $3::int, $4::int,
                   jsonb_build_object('max_per_coin_bps', $3::int, 'max_trades_per_day', $4::int),
                   decode($5::text, 'hex'), 'create')
           on conflict (bot_id, version) do nothing`,
          [id, draft?.rules ?? "", bot.maxPerCoinBps, bot.maxTradesPerDay, bot.personaHash.slice(2)],
        );
      });
    }
  }

  private async findUnsent(): Promise<void> {
    const since = new Date(this.deps.now().getTime() - DEBUT_WINDOW_MS).toISOString();
    const { rows } = await this.deps.db.query<{ id: string }>(
      `select s.id::text as id from slots s
       where s.kind = 'debut' and s.slot_time >= $1::timestamptz
         and exists (select 1 from decisions d where d.slot_id = s.id and d.status = 'executed')`,
      [since],
    );
    for (const { id } of rows) this.unsent.set(id, 0);
    this.resumed = true;
  }

  private async resend(): Promise<void> {
    if (this.unsent.size === 0) return;
    const market = await readMarket(this.deps, null);
    for (const [slotId, tries] of this.unsent) {
      const { failedBots } = await deliver(this.deps, await decisionsOfSlot(this.deps.db, slotId), market);
      if (failedBots.size === 0 || tries + 1 >= MAX_TRIES) this.unsent.delete(slotId);
      else this.unsent.set(slotId, tries + 1);
    }
  }

  private async waitingForDebut(): Promise<bigint[]> {
    const { rows } = await this.deps.db.query<{ id: string }>(
      `select b.id::text as id from bots b
       where not b.is_house and b.status = 'active' and b.created_at >= $1::timestamptz
         and not exists (
           select 1 from decisions d join slots s on s.id = d.slot_id where d.bot_id = b.id and s.kind = 'debut'
         )
       order by b.id`,
      [new Date(this.deps.now().getTime() - DEBUT_WINDOW_MS).toISOString()],
    );
    return rows.map((row) => BigInt(row.id)).filter((id) => (this.tries.get(id) ?? 0) < MAX_TRIES);
  }

  private async debut(botId: bigint): Promise<void> {
    const { db, chain, log } = this.deps;
    this.tries.set(botId, (this.tries.get(botId) ?? 0) + 1);
    try {
      const time = this.deps.now();
      const { rows } = await db.query<{ id: string; season_id: number | null }>(
        `insert into slots (slot_time, kind, season_id)
         values ($1::timestamptz, 'debut',
                 (select id from seasons where starts_at <= $1::timestamptz and ends_at > $1::timestamptz order by id limit 1))
         returning id::text as id, season_id`,
        [time.toISOString()],
      );
      const slot: Slot = { id: rows[0]!.id, kind: "debut", time, season: null };
      const market = await readMarket(this.deps, null);
      await saveOracleReads(db, slot.id, market.readings);
      if (!(await decideBot(this.deps, slot, botId, market))) return;

      const { failedBots } = await deliver(this.deps, await decisionsOfSlot(db, slot.id), market);
      if (failedBots.size > 0) {
        this.unsent.set(slot.id, 0);
        return;
      }
      const { portfolio } = await chain.state(botId, Math.floor(time.getTime() / 1000));
      await saveMark(db, slot.id, botId, portfolio, await markPrices(db, market));
      this.record();
    } catch (error) {
      log.warn("debut.failed", { botId, error: errorLabel(error) });
      this.record("failed");
    }
  }

  /** /healthz (public, so no bot id) and the job-failure alert. A later success clears it. */
  private record(problem?: string): void {
    this.deps.health.recordJobRun("debut", { at: this.deps.now().toISOString(), problem });
  }
}
