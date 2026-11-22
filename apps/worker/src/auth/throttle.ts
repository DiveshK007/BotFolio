/**
 * In-memory fixed window against floods (single instance, reset on restart). Not a product limit: those live in
 * relay_log (#39). Bounded: when full, the oldest key is dropped.
 */
export class Throttle {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 50_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** null = allowed, otherwise the seconds to wait. */
  take(key: string): number | null {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
      this.windows.delete(key); // re-inserted at the end, so the map stays oldest-first
      if (this.windows.size >= this.maxKeys) this.windows.delete(this.windows.keys().next().value!);
      window = { start: now, count: 0 };
      this.windows.set(key, window);
    }
    if (window.count >= this.limit) return Math.max(1, Math.ceil((window.start + this.windowMs - now) / 1000));
    window.count++;
    return null;
  }
}
