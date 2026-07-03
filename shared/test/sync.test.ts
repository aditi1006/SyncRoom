import { describe, expect, it } from 'vitest';
import {
  ClockSync,
  correctionFor,
  DRIFT_DEADZONE_S,
  DRIFT_HARD_SEEK_S,
  expectedTime,
  isValidPlaybackRate,
} from '../src/sync';
import type { SyncState } from '../src/types';

const base: SyncState = {
  media: null,
  playing: true,
  time: 100,
  rate: 1,
  updatedAt: 1_000_000,
  seq: 1,
};

describe('expectedTime', () => {
  it('advances with wall clock while playing', () => {
    expect(expectedTime(base, 1_010_000)).toBeCloseTo(110);
  });

  it('respects playback rate', () => {
    expect(expectedTime({ ...base, rate: 2 }, 1_010_000)).toBeCloseTo(120);
  });

  it('freezes when paused', () => {
    expect(expectedTime({ ...base, playing: false }, 1_999_000)).toBe(100);
  });

  it('never goes backwards from clock skew', () => {
    expect(expectedTime(base, 999_000)).toBe(100);
  });
});

describe('correctionFor', () => {
  it('ignores drift inside the 150ms deadzone', () => {
    expect(correctionFor(100 + DRIFT_DEADZONE_S / 2, 100, 1)).toEqual({ type: 'none' });
    expect(correctionFor(100 - DRIFT_DEADZONE_S / 2, 100, 1)).toEqual({ type: 'none' });
  });

  it('nudges rate gently (2-4%) for drift between 150 and 500ms', () => {
    const ahead = correctionFor(100.3, 100, 1);
    const behind = correctionFor(99.7, 100, 1);
    expect(ahead.type).toBe('nudge');
    expect(behind.type).toBe('nudge');
    if (ahead.type === 'nudge') {
      expect(ahead.rate).toBeLessThan(1);
      expect(ahead.rate).toBeGreaterThanOrEqual(0.96);
    }
    if (behind.type === 'nudge') {
      expect(behind.rate).toBeGreaterThan(1);
      expect(behind.rate).toBeLessThanOrEqual(1.04);
    }
  });

  it('scales nudge with drift but never beyond 4%', () => {
    const small = correctionFor(100.18, 100, 1);
    const large = correctionFor(100.45, 100, 1);
    if (small.type === 'nudge' && large.type === 'nudge') {
      expect(1 - large.rate).toBeGreaterThan(1 - small.rate);
      expect(large.rate).toBeGreaterThanOrEqual(0.96);
    } else {
      throw new Error('expected nudges');
    }
  });

  it('hard seeks only past 500ms drift', () => {
    expect(correctionFor(100 + DRIFT_HARD_SEEK_S, 100, 1)).toEqual({ type: 'seek', to: 100 });
    expect(correctionFor(110, 100, 1)).toEqual({ type: 'seek', to: 100 });
    expect(correctionFor(100.49, 100, 1).type).toBe('nudge');
  });

  it('respects the base playback rate when nudging', () => {
    const nudged = correctionFor(100.3, 100, 1.5);
    if (nudged.type !== 'nudge') throw new Error('expected nudge');
    expect(nudged.rate).toBeLessThan(1.5);
    expect(nudged.rate).toBeGreaterThan(1.4);
  });
});

describe('ClockSync', () => {
  it('estimates offset from the lowest-RTT sample', () => {
    const cs = new ClockSync();
    // client clock is 500ms behind server: offset should be ~+500
    cs.addSample(1000, 1750, 1500); // rtt 500 -> offset 1750-1250=500
    cs.addSample(2000, 2540, 2080); // rtt 80  -> offset 2540-2040=500
    expect(cs.offset).toBeCloseTo(500);
    expect(cs.serverNow(3000)).toBeCloseTo(3500);
  });

  it('reports the most recent RTT', () => {
    const cs = new ClockSync();
    expect(cs.lastRtt).toBe(0);
    cs.addSample(1000, 1750, 1500);
    expect(cs.lastRtt).toBe(500);
    cs.addSample(2000, 2540, 2080);
    expect(cs.lastRtt).toBe(80);
  });

  it('returns 0 with no samples', () => {
    expect(new ClockSync().offset).toBe(0);
  });
});

describe('isValidPlaybackRate', () => {
  it('bounds rates to 0.25-2', () => {
    expect(isValidPlaybackRate(1)).toBe(true);
    expect(isValidPlaybackRate(0.1)).toBe(false);
    expect(isValidPlaybackRate(4)).toBe(false);
    expect(isValidPlaybackRate(NaN)).toBe(false);
  });
});
