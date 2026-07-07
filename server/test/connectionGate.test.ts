import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { ConnectionGate } from '../src/connectionGate';

const req = {} as IncomingMessage;

describe('ConnectionGate', () => {
  it('admits connections below the cap immediately', () => {
    const gate = new ConnectionGate({
      maxConnections: 3,
      burstPerSec: 100,
      maxStaggerMs: 500,
      currentCount: () => 0,
      now: () => 0,
    });
    const cb = vi.fn();
    gate.allowRequest(req, cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it('rejects new connections at the hard cap', () => {
    let count = 0;
    const onReject = vi.fn();
    const gate = new ConnectionGate({
      maxConnections: 3,
      burstPerSec: 100,
      maxStaggerMs: 500,
      currentCount: () => count,
      now: () => 0,
      onReject,
    });
    count = 3;
    const cb = vi.fn();
    gate.allowRequest(req, cb);
    expect(cb).toHaveBeenCalledWith('Server busy', false);
    expect(onReject).toHaveBeenCalledWith(3);
  });

  it('admits a burst up to capacity synchronously, then staggers the excess', () => {
    vi.useFakeTimers();
    try {
      const clock = 0;
      const gate = new ConnectionGate({
        maxConnections: 1000,
        burstPerSec: 5,
        maxStaggerMs: 500,
        currentCount: () => 0,
        now: () => clock,
      });

      // First 5 admit immediately (bucket starts full).
      for (let i = 0; i < 5; i++) {
        const cb = vi.fn();
        gate.allowRequest(req, cb);
        expect(cb).toHaveBeenCalledWith(null, true);
      }

      // The 6th has no token: it is deferred, not called synchronously.
      const deferred = vi.fn();
      gate.allowRequest(req, deferred);
      expect(deferred).not.toHaveBeenCalled();

      // It resolves (admitted) once the stagger timer fires.
      vi.runAllTimers();
      expect(deferred).toHaveBeenCalledWith(null, true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a staggered connection if the cap fills during its wait', () => {
    vi.useFakeTimers();
    try {
      let count = 0;
      const gate = new ConnectionGate({
        maxConnections: 10,
        burstPerSec: 1,
        maxStaggerMs: 200,
        currentCount: () => count,
        now: () => 0,
      });
      gate.allowRequest(req, vi.fn()); // consumes the only token

      const deferred = vi.fn();
      gate.allowRequest(req, deferred); // staggered
      count = 10; // cap fills while it waits
      vi.runAllTimers();
      expect(deferred).toHaveBeenCalledWith('Server busy', false);
    } finally {
      vi.useRealTimers();
    }
  });
});
