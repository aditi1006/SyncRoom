import { useEffect, useState } from 'react';
import type { PeersRef } from './usePeerConnections';

export interface PeerStats {
  rttMs: number;
  packetLossPct: number;
  outboundKbps: number;
  quality: 'good' | 'fair' | 'poor';
}

function rate(quality: { rttMs: number; packetLossPct: number }): PeerStats['quality'] {
  if (quality.rttMs > 400 || quality.packetLossPct > 8) return 'poor';
  if (quality.rttMs > 180 || quality.packetLossPct > 3) return 'fair';
  return 'good';
}

/**
 * Samples RTCStats every 2s per peer: round-trip time from the nominated
 * candidate pair, loss from remote-inbound-rtp, bitrate from outbound-rtp
 * byte deltas.
 */
export function useCallStats(peersRef: PeersRef, active: boolean): Record<string, PeerStats> {
  const [stats, setStats] = useState<Record<string, PeerStats>>({});

  useEffect(() => {
    if (!active) {
      setStats({});
      return;
    }
    const lastBytes = new Map<string, { bytes: number; at: number }>();

    const sample = async (): Promise<void> => {
      const next: Record<string, PeerStats> = {};
      for (const [peerId, peer] of peersRef.current) {
        if (peer.pc.connectionState !== 'connected') continue;
        try {
          const report = await peer.pc.getStats();
          let rttMs = 0;
          let packetLossPct = 0;
          let bytesSent = 0;
          let packetsSent = 0;
          let packetsLost = 0;

          report.forEach((entry) => {
            if (entry.type === 'candidate-pair' && entry.state === 'succeeded' && entry.nominated) {
              const rtt = entry.currentRoundTripTime as number | undefined;
              if (typeof rtt === 'number') rttMs = Math.round(rtt * 1000);
            }
            if (entry.type === 'outbound-rtp' && entry.kind === 'video') {
              bytesSent += (entry.bytesSent as number | undefined) ?? 0;
              packetsSent += (entry.packetsSent as number | undefined) ?? 0;
            }
            if (entry.type === 'remote-inbound-rtp' && entry.kind === 'video') {
              packetsLost += (entry.packetsLost as number | undefined) ?? 0;
            }
          });

          if (packetsSent > 0) {
            packetLossPct = Math.min(100, (packetsLost / (packetsSent + packetsLost)) * 100);
          }

          const now = Date.now();
          const last = lastBytes.get(peerId);
          let outboundKbps = 0;
          if (last && now > last.at) {
            outboundKbps = Math.max(
              0,
              Math.round(((bytesSent - last.bytes) * 8) / (now - last.at)),
            );
          }
          lastBytes.set(peerId, { bytes: bytesSent, at: now });

          next[peerId] = {
            rttMs,
            packetLossPct: Math.round(packetLossPct * 10) / 10,
            outboundKbps,
            quality: rate({ rttMs, packetLossPct }),
          };
        } catch {
          /* stats can fail transiently during renegotiation */
        }
      }
      setStats(next);
    };

    const timer = setInterval(() => void sample(), 2000);
    return () => clearInterval(timer);
  }, [peersRef, active]);

  return stats;
}
