const DAY_MS = 86_400_000;

/**
 * New bots per IP per rolling day. relay_log has no IP column (frozen schema), so this is in memory:
 * ONE INSTANCE ONLY, AND A RESTART RESETS IT. Check-and-reserve is synchronous, so parallel requests can't
 * share a slot. Bounded: when full it refuses new IPs instead of forgetting old ones.
 */
export class NewBotIpLimit {
  private readonly slots = new Map<string, { at: number }[]>();

  constructor(
    private readonly limit: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 100_000,
  ) {}

  tryReserve(ip: string): { release: () => void } | { retryAfterSeconds: number } {
    const now = this.now();
    if (!this.slots.has(ip) && this.slots.size >= this.maxKeys) {
      this.sweep(now);
      if (this.slots.size >= this.maxKeys) return { retryAfterSeconds: 3600 };
    }
    const live = (this.slots.get(ip) ?? []).filter((slot) => slot.at > now - DAY_MS);
    this.slots.set(ip, live);
    if (live.length >= this.limit) {
      return { retryAfterSeconds: Math.max(1, Math.ceil((live[0]!.at + DAY_MS - now) / 1000)) };
    }
    const mine = { at: now };
    live.push(mine);
    return {
      release: () => {
        const current = this.slots.get(ip) ?? [];
        const index = current.indexOf(mine);
        if (index >= 0) current.splice(index, 1);
        if (current.length === 0) this.slots.delete(ip);
      },
    };
  }

  private sweep(now: number): void {
    for (const [ip, slots] of this.slots) if (slots.every((slot) => slot.at <= now - DAY_MS)) this.slots.delete(ip);
  }
}
