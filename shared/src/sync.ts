import type { SyncState } from './types';

/**
 * Drift policy (Teleparty-style):
 *   |drift| <= 150 ms  -> ignore (normal player jitter)
 *   150–500 ms         -> gentle playback-rate nudge (invisible to viewer)
 *   |drift| >= 500 ms  -> single hard seek
 */
export const DRIFT_DEADZONE_S = 0.15;
export const DRIFT_HARD_SEEK_S = 0.5;
/** Nudge magnitude bounds: 2%..4% of playback rate. */
export const DRIFT_NUDGE_MIN = 0.02;
export const DRIFT_NUDGE_MAX = 0.04;
/** Interval between drift comparisons, ms. */
export const DRIFT_CHECK_INTERVAL_MS = 2000;

export const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function isValidPlaybackRate(rate: number): boolean {
  return Number.isFinite(rate) && rate >= 0.25 && rate <= 2;
}

export function isValidTime(time: number): boolean {
  return Number.isFinite(time) && time >= 0 && time < 60 * 60 * 24;
}

/**
 * Expected playback position for a host-authoritative state at `serverNow`
 * (a server-clock timestamp in ms, client must add its measured offset).
 */
export function expectedTime(state: SyncState, serverNow: number): number {
  if (!state.playing) return state.time;
  const elapsed = Math.max(0, serverNow - state.updatedAt) / 1000;
  return state.time + elapsed * state.rate;
}

export type DriftAction =
  { type: 'none' } | { type: 'seek'; to: number } | { type: 'nudge'; rate: number };

/**
 * Decides how a client corrects drift between its local player position and
 * the authoritative expected position. Never emits repeated seeks: small
 * drift is reeled in by temporarily running the player 2–4% fast/slow.
 */
export function correctionFor(localTime: number, target: number, baseRate: number): DriftAction {
  const drift = localTime - target; // positive = we are ahead
  const abs = Math.abs(drift);
  if (abs <= DRIFT_DEADZONE_S) return { type: 'none' };
  if (abs >= DRIFT_HARD_SEEK_S) return { type: 'seek', to: target };
  const span = DRIFT_HARD_SEEK_S - DRIFT_DEADZONE_S;
  const magnitude =
    DRIFT_NUDGE_MIN + ((abs - DRIFT_DEADZONE_S) / span) * (DRIFT_NUDGE_MAX - DRIFT_NUDGE_MIN);
  const factor = drift > 0 ? 1 - magnitude : 1 + magnitude;
  return { type: 'nudge', rate: Math.min(2, Math.max(0.25, baseRate * factor)) };
}

/**
 * Rolling estimate of the offset between the client clock and server clock.
 * offset = serverNow - clientNow; keep the sample with the lowest RTT
 * (NTP-style best-sample filtering over a sliding window).
 */
export class ClockSync {
  private samples: Array<{ offset: number; rtt: number }> = [];
  private readonly maxSamples: number;

  constructor(maxSamples = 8) {
    this.maxSamples = maxSamples;
  }

  addSample(clientSent: number, serverNow: number, clientReceived: number): void {
    const rtt = clientReceived - clientSent;
    const offset = serverNow - (clientSent + rtt / 2);
    this.samples.push({ offset, rtt });
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  /** Best current estimate of (server clock - client clock) in ms. */
  get offset(): number {
    if (this.samples.length === 0) return 0;
    let best = this.samples[0]!;
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    return best.offset;
  }

  /** Most recent round-trip time in ms (socket latency indicator). */
  get lastRtt(): number {
    return this.samples[this.samples.length - 1]?.rtt ?? 0;
  }

  serverNow(clientNow: number): number {
    return clientNow + this.offset;
  }
}
