import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { Server } from 'socket.io';
import { LIMITS } from '@syncroom/shared';
import type { AppServer } from './handlers';
import { registerHandlers } from './handlers';
import { RoomManager } from './roomManager';
import { driveProxy } from './driveProxy';
import { makeOriginCheck, parseAllowedOrigins } from './cors';
import { config } from './config';
import { ConnectionGate } from './connectionGate';

const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.CLIENT_ORIGIN);

// Single-service deployments serve the SPA from this same process, so the
// browser's WebSocket handshake is same-origin. Render exposes the public URL
// as RENDER_EXTERNAL_URL, auto-allow it (and its www/non-www) so sockets
// connect without anyone having to hand-set CLIENT_ORIGIN. Harmless elsewhere
// (the var is only present on Render).
const selfOrigin = process.env.RENDER_EXTERNAL_URL?.replace(/\/+$/, '');
if (selfOrigin && !ALLOWED_ORIGINS.includes(selfOrigin)) {
  ALLOWED_ORIGINS.push(selfOrigin);
}
console.log(`[syncroom] allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);

if (!config.isProduction) {
  console.warn(`[syncroom] NODE_ENV=${config.nodeEnv} (set NODE_ENV=production in deployment)`);
}

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), connections: io.engine.clientsCount });
});

// Streams a public Google Drive file so it plays in the synced HTML5 player
// instead of Drive's un-syncable preview iframe. This is the ONLY path where
// bytes flow through the server (WebRTC media is strictly peer-to-peer), so it
// is capped: past `maxDriveStreams` concurrent streams new requests get a 503
// rather than letting a few large streams saturate the instance. The proxy
// itself streams (never buffers the whole file) and aborts on client close.
let activeDriveStreams = 0;
app.get('/drive/:id', (req: Request, res: Response, next: NextFunction) => {
  if (activeDriveStreams >= config.maxDriveStreams) {
    res.status(503).set('Retry-After', '5').json({ error: 'Server busy, please retry shortly.' });
    return;
  }
  activeDriveStreams += 1;
  res.on('close', () => {
    activeDriveStreams -= 1;
  });
  void driveProxy(req, res).catch(next);
});

// In single-process deployments the server also serves the built SPA. In split
// deployments (SPA on a CDN/static host, this box for signaling only) set
// SERVE_CLIENT=false so the process does zero static I/O. Hashed asset files
// are immutable and cached hard; index.html is always revalidated so a deploy
// is picked up immediately.
const dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(dirname, '../../client/dist');
if (config.serveClient && existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      index: 'index.html',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const httpServer = createServer(app);

// Overload protection + burst smoothing, applied at the handshake (before a
// socket is allocated) via Engine.IO's `allowRequest`.
let lastRejectLogAt = 0;
const gate = new ConnectionGate({
  maxConnections: config.maxConnections,
  burstPerSec: config.connectionBurstPerSec,
  maxStaggerMs: config.connectionMaxStaggerMs,
  currentCount: () => io.engine.clientsCount,
  onReject: (count) => {
    const now = Date.now();
    if (now - lastRejectLogAt > 5000) {
      lastRejectLogAt = now;
      console.warn(`[syncroom] connection rejected: at capacity (${count}/${config.maxConnections})`);
    }
  },
});

const io: AppServer = new Server(httpServer, {
  cors: {
    origin: makeOriginCheck(ALLOWED_ORIGINS),
    methods: ['GET', 'POST'],
  },
  // Attachments are relayed through the socket; allow cap + base64 overhead.
  maxHttpBufferSize: Math.ceil(LIMITS.MAX_ATTACHMENT_BYTES * 1.5),
  // Built-in heartbeat: ping every `pingIntervalMs`, drop the socket if no pong
  // within `pingTimeoutMs`. This is what evicts abandoned tabs; the `disconnect`
  // handler then frees their room/rate-limiter state. No manual ping loop, that
  // would only duplicate the transport's own liveness check.
  pingInterval: config.pingIntervalMs,
  pingTimeout: config.pingTimeoutMs,
  // WebSocket per-message compression OFF by default. On a shared-CPU instance
  // deflate's CPU/memory cost outweighs the benefit: the socket carries only
  // small JSON signaling (media is P2P), and compressing every frame would add
  // latency and allocations under load. Re-enable via a code change only if a
  // profiler shows bandwidth (not CPU) is the bottleneck.
  perMessageDeflate: false,
  allowRequest: gate.allowRequest,
});

const rooms = new RoomManager();
registerHandlers(io, rooms);

httpServer.listen(config.port, () => {
  console.log(
    `[syncroom] signaling server listening on :${config.port} ` +
      `(env=${config.nodeEnv}, maxConnections=${config.maxConnections}, ` +
      `serveClient=${config.serveClient && existsSync(clientDist)})`,
  );
});

/* ------------------------------ reliability ------------------------------ */

// Optional self-restart guard: if RSS crosses the limit, exit cleanly so the
// platform restarts a fresh process, turning a slow leak into a brief blip
// instead of an OOM kill. Disabled when memoryLimitMb === 0.
let memoryTimer: NodeJS.Timeout | undefined;
if (config.memoryLimitMb > 0) {
  memoryTimer = setInterval(() => {
    const rssMb = process.memoryUsage().rss / (1024 * 1024);
    if (rssMb > config.memoryLimitMb) {
      console.error(
        `[syncroom] RSS ${rssMb.toFixed(0)}MB exceeded MEMORY_LIMIT_MB=${config.memoryLimitMb}, restarting`,
      );
      shutdown(1);
    }
  }, 30_000);
  memoryTimer.unref();
}

let shuttingDown = false;
function shutdown(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  if (memoryTimer) clearInterval(memoryTimer);
  // Stop new work, let in-flight sockets close, then exit. The unref'd timer is
  // a hard backstop so a hung connection can't block the restart.
  io.close();
  httpServer.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 3000).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// Never let a stray rejection or exception take the process down uncleanly. A
// rejection is logged (the process stays up); an uncaught exception leaves the
// process in an undefined state, so we log and restart via graceful shutdown.
process.on('unhandledRejection', (reason) => {
  console.error('[syncroom] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[syncroom] uncaughtException:', err);
  shutdown(1);
});
