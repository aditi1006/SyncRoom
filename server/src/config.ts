/**
 * Runtime configuration, read once at boot from the environment.
 *
 * Every scalability knob is configurable so the same image runs on a free
 * Render instance (small caps) or a beefy VPS (large caps) by env alone, no
 * rebuild. Defaults are tuned for a single ~512 MB / shared-CPU instance.
 */

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

export const config = {
  port: int('PORT', 3001),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: (process.env.NODE_ENV ?? 'development') === 'production',

  /**
   * Hard ceiling on concurrent WebSocket clients. New handshakes past this are
   * rejected at the Engine.IO layer (HTTP 403) *before* a socket is allocated,
   * so a connection spike can never starve users who are already in a room.
   * ~512 MB comfortably holds a few hundred idle signaling sockets; 150 leaves
   * generous headroom. Raise on larger instances.
   */
  maxConnections: int('MAX_CONNECTIONS', 150),

  /**
   * Connection-burst smoothing. Handshakes are admitted at up to
   * `connectionBurstPerSec` per second; excess handshakes are *staggered*
   * (delayed up to `connectionMaxStaggerMs`, never dropped) so hundreds of
   * simultaneous joins don't spike CPU or block the event loop. The delay is
   * applied with an unref'd timer, so the loop stays free while waiting.
   */
  connectionBurstPerSec: int('CONNECTION_BURST_PER_SEC', 20),
  connectionMaxStaggerMs: int('CONNECTION_MAX_STAGGER_MS', 500),

  /**
   * Heartbeat. Engine.IO sends a ping every `pingIntervalMs`; if no pong
   * arrives within `pingTimeoutMs` the socket is terminated and our `disconnect`
   * handler frees its room/membership/rate-limiter state. This is what reaps
   * abandoned browser tabs, no separate ping loop is needed (that would just
   * duplicate what the transport already does).
   */
  pingIntervalMs: int('PING_INTERVAL_MS', 30_000),
  pingTimeoutMs: int('PING_TIMEOUT_MS', 60_000),

  /**
   * Max concurrent Google-Drive proxy streams. This is the only path where
   * bytes flow *through* the box (media proper is P2P); without a cap a handful
   * of large streams could saturate the instance's bandwidth/memory. Excess
   * requests get a 503 + Retry-After instead of degrading everyone.
   */
  maxDriveStreams: int('MAX_DRIVE_STREAMS', 8),

  /**
   * Self-restart guard. When RSS exceeds this many MB the process logs and
   * exits gracefully so the platform (Render/PM2/systemd) restarts it clean,
   * turning a slow leak into a blip instead of an OOM kill. 0 disables it.
   * On Render free (512 MB) ~450 is a safe value; left off by default so it
   * never surprises a large host.
   */
  memoryLimitMb: int('MEMORY_LIMIT_MB', 0),

  /**
   * Whether this process should also serve the built SPA. Defaults on (single
   * "one process, one port" deployments). Set false in split deployments where
   * a CDN/static host (Vercel, Render Static, Cloudflare, Netlify) serves the
   * frontend and this box handles signaling only, offloading all static I/O.
   */
  serveClient: bool('SERVE_CLIENT', true),
} as const;

export type Config = typeof config;
