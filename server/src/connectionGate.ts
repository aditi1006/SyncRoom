import type { IncomingMessage } from 'node:http';

/**
 * Admission control for new WebSocket handshakes, wired into Socket.IO via the
 * `allowRequest` option so decisions happen *before* a socket is allocated.
 *
 * Two protections, both aimed at surviving load spikes without hurting the
 * users already connected:
 *
 *  1. Hard cap (overload protection). Past `maxConnections` new handshakes are
 *     rejected (Engine.IO replies 403; socket.io-client then retries with
 *     backoff). Existing sockets are untouched, so a flood of newcomers can
 *     never evict or starve people mid-call.
 *
 *  2. Burst smoothing. Admissions are metered by a token bucket
 *     (`burstPerSec`). When a burst outruns the bucket, the *excess* handshakes
 *     are delayed (up to `maxStaggerMs`) rather than dropped, spreading the
 *     per-connection setup cost over time so hundreds of simultaneous joins
 *     don't spike CPU or block the event loop. The wait uses an unref'd timer,
 *     the loop stays free while a handshake waits its turn.
 */
export interface ConnectionGateOptions {
  maxConnections: number;
  burstPerSec: number;
  maxStaggerMs: number;
  /** Live client count (Engine.IO's authoritative counter). */
  currentCount: () => number;
  /** Injectable clock + logger for tests. */
  now?: () => number;
  onReject?: (count: number) => void;
}

export class ConnectionGate {
  private tokens: number;
  private updatedAt: number;
  private readonly now: () => number;

  constructor(private readonly opts: ConnectionGateOptions) {
    this.now = opts.now ?? Date.now;
    this.tokens = opts.burstPerSec;
    this.updatedAt = this.now();
  }

  /** Refill the bucket based on elapsed time and return current token count. */
  private refill(): number {
    const t = this.now();
    const elapsed = (t - this.updatedAt) / 1000;
    this.tokens = Math.min(this.opts.burstPerSec, this.tokens + elapsed * this.opts.burstPerSec);
    this.updatedAt = t;
    return this.tokens;
  }

  /**
   * Engine.IO `allowRequest` handler. Calls `cb(null, true)` to admit (possibly
   * after a stagger delay) or `cb(message, false)` to reject.
   */
  allowRequest = (
    _req: IncomingMessage,
    cb: (err: string | null | undefined, success: boolean) => void,
  ): void => {
    if (this.opts.currentCount() >= this.opts.maxConnections) {
      this.opts.onReject?.(this.opts.currentCount());
      cb('Server busy', false);
      return;
    }

    const tokens = this.refill();
    if (tokens >= 1) {
      this.tokens -= 1;
      cb(null, true);
      return;
    }

    // No token free: stagger this handshake instead of processing it instantly.
    const waitMs = Math.min(
      this.opts.maxStaggerMs,
      Math.ceil(((1 - tokens) / this.opts.burstPerSec) * 1000),
    );
    this.tokens = 0;
    const timer = setTimeout(() => {
      // Re-check the hard cap: the crowd may have filled it during the wait.
      if (this.opts.currentCount() >= this.opts.maxConnections) {
        this.opts.onReject?.(this.opts.currentCount());
        cb('Server busy', false);
        return;
      }
      cb(null, true);
    }, waitMs);
    timer.unref?.();
  };
}
