import { create } from 'zustand';

/**
 * Diagnostics for the sync pipeline. Rendered by <DebugOverlay> only when
 * debug mode is on; the counters are cheap either way.
 *
 * Enable with `?debug` in the URL or `localStorage['syncroom:debug']='1'`
 * (persisted opt-in). Off by default in production builds.
 */

export function isDebugEnabled(): boolean {
  try {
    return (
      new URLSearchParams(window.location.search).has('debug') ||
      localStorage.getItem('syncroom:debug') === '1'
    );
  } catch {
    return false;
  }
}

interface SyncDebugState {
  provider: string;
  phase: string;
  playback: string;
  time: number;
  driftMs: number;
  lastEvent: string;
  latencyMs: number;
  sent: number;
  received: number;
  dropped: number;
  set: (patch: Partial<Omit<SyncDebugState, 'set' | 'bump'>>) => void;
  bump: (counter: 'sent' | 'received' | 'dropped', lastEvent?: string) => void;
}

export const useSyncDebug = create<SyncDebugState>((set) => ({
  provider: ', ',
  phase: 'idle',
  playback: ', ',
  time: 0,
  driftMs: 0,
  lastEvent: ', ',
  latencyMs: 0,
  sent: 0,
  received: 0,
  dropped: 0,
  set: (patch) => set(patch),
  bump: (counter, lastEvent) =>
    set((s) => ({ [counter]: s[counter] + 1, ...(lastEvent ? { lastEvent } : {}) })),
}));
