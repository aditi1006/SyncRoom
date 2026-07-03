import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@syncroom/shared';
import { ClockSync } from '@syncroom/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Single shared socket. Same-origin by default (dev proxies /socket.io to the
 * signaling server); VITE_SERVER_URL overrides for split deployments.
 */
const serverUrl = import.meta.env.VITE_SERVER_URL as string | undefined;

export const socket: AppSocket = io(serverUrl ?? '/', {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
});

/** Client↔server clock offset estimator — the sync engine depends on it. */
export const clock = new ClockSync();

export function serverNow(): number {
  return clock.serverNow(Date.now());
}

let pingTimer: ReturnType<typeof setInterval> | null = null;

export function startClockSync(): void {
  const ping = (): void => {
    const sent = Date.now();
    socket.emit('time:ping', sent, (serverTime) => {
      clock.addSample(sent, serverTime, Date.now());
    });
  };
  ping();
  if (!pingTimer) pingTimer = setInterval(ping, 10_000);
}

export function stopClockSync(): void {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}
