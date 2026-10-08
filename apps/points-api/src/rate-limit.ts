/**
 * Fixed-window counter held in memory. The API runs as one Railway
 * instance, so a shared store isn't needed; a restart resets the windows,
 * which only ever loosens limits briefly.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Counts one request for `key`; false once the window's limit is spent. */
  allow(key: string, nowMs: number): boolean {
    const window = this.windows.get(key);
    if (!window || nowMs - window.startedAt >= this.windowMs) {
      this.prune(nowMs);
      this.windows.set(key, { startedAt: nowMs, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= this.limit;
  }

  private prune(nowMs: number): void {
    for (const [key, window] of this.windows) {
      if (nowMs - window.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }
}
