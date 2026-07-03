/**
 * Token-bucket rate limiter. One bucket per (key, class); buckets refill
 * continuously and are lazily created. Memory is reclaimed by `sweep()`.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateRule {
  /** Maximum burst size. */
  capacity: number;
  /** Tokens restored per second. */
  refillPerSec: number;
}

export const RATE_RULES = {
  join: { capacity: 15, refillPerSec: 0.5 },
  chat: { capacity: 12, refillPerSec: 1.5 },
  sync: { capacity: 20, refillPerSec: 8 },
  signal: { capacity: 120, refillPerSec: 40 },
  generic: { capacity: 40, refillPerSec: 15 },
} as const satisfies Record<string, RateRule>;

export type RateClass = keyof typeof RATE_RULES;

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Returns true when the action is allowed (and consumes a token). */
  allow(key: string, cls: RateClass): boolean {
    const rule = RATE_RULES[cls];
    const id = `${cls}:${key}`;
    const t = this.now();
    let bucket = this.buckets.get(id);
    if (!bucket) {
      bucket = { tokens: rule.capacity, updatedAt: t };
      this.buckets.set(id, bucket);
    }
    const elapsed = (t - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(rule.capacity, bucket.tokens + elapsed * rule.refillPerSec);
    bucket.updatedAt = t;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  /** Drops buckets idle longer than `idleMs` (call periodically). */
  sweep(idleMs = 10 * 60 * 1000): void {
    const cutoff = this.now() - idleMs;
    for (const [id, bucket] of this.buckets) {
      if (bucket.updatedAt < cutoff) this.buckets.delete(id);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}
