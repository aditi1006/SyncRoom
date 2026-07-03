import { useEffect } from 'react';
import { clock } from '@/lib/socket';
import { formatDuration } from '@/lib/utils';
import { isDebugEnabled, useSyncDebug } from './debug';

/**
 * Sync diagnostics HUD. Only mounts when debug mode is enabled
 * (`?debug` or `localStorage['syncroom:debug']='1'`); see docs/DEVELOPMENT.md.
 */
export function DebugOverlay() {
  const d = useSyncDebug();
  const set = useSyncDebug((s) => s.set);

  useEffect(() => {
    const t = setInterval(() => set({ latencyMs: Math.round(clock.lastRtt) }), 2000);
    return () => clearInterval(t);
  }, [set]);

  if (!isDebugEnabled()) return null;

  const rows: Array<[string, string]> = [
    ['provider', d.provider],
    ['phase', d.phase],
    ['playback', d.playback],
    ['time', formatDuration(d.time)],
    ['drift', `${d.driftMs} ms`],
    ['last event', d.lastEvent],
    ['latency', `${d.latencyMs} ms`],
    ['msgs sent / recv', `${d.sent} / ${d.received}`],
    ['dropped', String(d.dropped)],
  ];

  return (
    <div className="pointer-events-none absolute left-2 top-2 z-20 rounded-lg bg-black/75 p-2.5 font-mono text-[10px] leading-relaxed text-green-300 shadow-lg">
      {rows.map(([k, v]) => (
        <div key={k}>
          <span className="text-green-500/70">{k.padEnd(17, ' ')}</span>
          {v}
        </div>
      ))}
    </div>
  );
}
