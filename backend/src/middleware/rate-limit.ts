/**
 * D1: a dependency-free sliding-window rate limiter.
 *
 * `POST /api/score` is public and unauthenticated (a signed/server-side result is deferred to the
 * multiplayer decision), so the only practical abuse control is frequency per client IP. This is a
 * pure module: no Express, no timers, and the clock is injected, which makes the "did it open again
 * after the window?" behaviour testable without waiting in real time.
 *
 * Memory is bounded by the number of *distinct* keys inside one window; stale buckets are dropped
 * on a maintenance sweep so a botnet-style sweep of unique IPs cannot grow the map forever.
 */
export interface RateCheck {
  allowed: boolean;
  /** Milliseconds until the oldest counted hit leaves the window (0 when allowed). */
  retryAfterMs: number;
  /** Hits still available in the current window (0 when the limit is exhausted). */
  remaining: number;
}

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  now?: () => number;
  /** Hard cap on tracked keys; above it a stale-key sweep runs, then the oldest keys are evicted. */
  maxKeys?: number;
}

export class RateLimiter {
  private readonly windowMs: number;
  private readonly max: number;
  private readonly now: () => number;
  private readonly maxKeys: number;
  private readonly hits = new Map<string, number[]>();

  constructor(opts: RateLimiterOptions) {
    if (!Number.isFinite(opts.windowMs) || opts.windowMs <= 0) {
      throw new RangeError('windowMs must be a positive number');
    }
    if (!Number.isInteger(opts.max) || opts.max <= 0) {
      throw new RangeError('max must be a positive integer');
    }
    this.windowMs = opts.windowMs;
    this.max = opts.max;
    this.now = opts.now ?? (() => Date.now());
    this.maxKeys = opts.maxKeys ?? 10_000;
  }

  check(key: string): RateCheck {
    const t = this.now();
    const fresh = (this.hits.get(key) ?? []).filter((ts) => t - ts < this.windowMs);

    if (fresh.length >= this.max) {
      this.hits.set(key, fresh);
      const oldest = fresh[0];
      return {
        allowed: false,
        retryAfterMs: Math.max(0, this.windowMs - (t - oldest)),
        remaining: 0,
      };
    }

    fresh.push(t);
    this.hits.set(key, fresh);
    this.sweepIfTooLarge(t);
    return { allowed: true, retryAfterMs: 0, remaining: this.max - fresh.length };
  }

  /** Tracked keys — exported for tests and for the health self-check. */
  get size(): number {
    return this.hits.size;
  }

  /** Requests allowed per window — read by the router to answer with honest headers. */
  get limit(): number {
    return this.max;
  }

  /** The window length in milliseconds. */
  get window(): number {
    return this.windowMs;
  }

  reset(): void {
    this.hits.clear();
  }

  private sweepIfTooLarge(t: number): void {
    // Strictly below the cap: at `maxKeys` we may still add one more key, and the sweep right
    // after that insert is what keeps the map from drifting past the cap.
    if (this.hits.size < this.maxKeys) return;
    for (const [k, list] of this.hits) {
      const fresh = list.filter((ts) => t - ts < this.windowMs);
      if (fresh.length === 0) this.hits.delete(k);
      else this.hits.set(k, fresh);
    }
    // Still too large (a flood of unique live keys): keep the busiest, drop the rest.
    if (this.hits.size > this.maxKeys) {
      const ordered = [...this.hits.entries()].sort((a, b) => b[1].length - a[1].length);
      this.hits.clear();
      for (const [k, list] of ordered.slice(0, this.maxKeys)) this.hits.set(k, list);
    }
  }
}
