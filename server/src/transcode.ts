import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import type { Response } from 'express';
import { config } from './config';
import { fetchDrive } from './driveProxy';

/**
 * On-the-fly Google Drive → HLS transcoder.
 *
 * Browsers can only decode a handful of containers/codecs in <video>
 * (MP4/H.264, WebM, Ogg). A Drive file in anything else (MPEG-2 .MPG, MKV,
 * AVI…) can otherwise only play in Drive's own preview iframe, which exposes
 * no playback API and so can't be synchronized. This module re-encodes such a
 * file to H.264/AAC and segments it as HLS, which the client plays through
 * hls.js in the fully-synced HTML5 player.
 *
 * One ffmpeg process per distinct file id, SHARED by every viewer watching it
 * (the encode is keyed on the id, not the request). Sessions are capped and
 * reaped after an idle grace so a watch party can't leave encoders running.
 * If ffmpeg is missing or fails, callers get a TranscodeError and the client
 * falls back to the unsynced embed exactly as before, transcoding is a
 * best-effort upgrade, never a hard dependency.
 */

const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;
/** ffmpeg writes seg00000.ts, seg00001.ts…; nothing else is servable. */
const SEGMENT = /^seg\d{5}\.ts$/;
const PLAYLIST = 'index.m3u8';

export type TranscodeErrorKind = 'bad-id' | 'busy' | 'upstream' | 'ffmpeg' | 'timeout';

export class TranscodeError extends Error {
  constructor(
    readonly kind: TranscodeErrorKind,
    message?: string,
  ) {
    super(message ?? kind);
    this.name = 'TranscodeError';
  }
}

interface Session {
  id: string;
  dir: string;
  proc: ChildProcess;
  abort: AbortController;
  lastAccess: number;
  failed: boolean;
  /** Tail of ffmpeg's stderr, for diagnostics on failure. */
  stderr: string;
  /** Resolves once the playlist references its first segment; rejects on failure. */
  ready: Promise<void>;
}

function ffmpegArgs(dir: string): string[] {
  // veryfast/crf 23 keeps a live encode ahead of real-time playback on a
  // shared CPU; yuv420p + high@4.1 is the maximally-compatible H.264 profile.
  // An "event" playlist grows as segments are written, so hls.js can start
  // (and seek within) the encoded range while the tail is still encoding.
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    'pipe:0',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-profile:v',
    'high',
    '-level',
    '4.1',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-ac',
    '2',
    '-f',
    'hls',
    '-hls_time',
    '4',
    '-hls_list_size',
    '0',
    '-hls_playlist_type',
    'event',
    '-hls_flags',
    'independent_segments',
    '-hls_segment_filename',
    path.join(dir, 'seg%05d.ts'),
    path.join(dir, PLAYLIST),
  ];
}

/** True once the playlist exists AND names at least one segment file. */
async function playlistHasSegment(dir: string): Promise<boolean> {
  try {
    const text = await readFile(path.join(dir, PLAYLIST), 'utf8');
    if (!text.includes('.ts')) return false;
    const files = await readdir(dir);
    return files.some((f) => SEGMENT.test(f));
  } catch {
    return false;
  }
}

export class TranscodeManager {
  private readonly sessions = new Map<string, Session>();
  /** In-flight starts, so concurrent first-hits share one encode, not N. */
  private readonly starting = new Map<string, Promise<Session>>();
  private readonly sweeper: ReturnType<typeof setInterval>;

  constructor() {
    this.sweeper = setInterval(() => void this.sweep(), 10_000);
    this.sweeper.unref();
  }

  /** Playlist bytes for a file id, starting the encode on first request. */
  async getPlaylist(id: string): Promise<Buffer> {
    if (!DRIVE_ID.test(id)) throw new TranscodeError('bad-id');
    const session = await this.ensure(id);
    session.lastAccess = Date.now();
    await session.ready;
    session.lastAccess = Date.now();
    return readFile(path.join(session.dir, PLAYLIST));
  }

  /**
   * Absolute path of an already-encoded segment, or null if the id/name is
   * invalid or the session/segment isn't present yet (hls.js will retry).
   */
  segmentPath(id: string, name: string): string | null {
    if (!DRIVE_ID.test(id) || !SEGMENT.test(name)) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    session.lastAccess = Date.now();
    return path.join(session.dir, name);
  }

  private ensure(id: string): Promise<Session> {
    const existing = this.sessions.get(id);
    if (existing && !existing.failed) return Promise.resolve(existing);
    let pending = this.starting.get(id);
    if (!pending) {
      pending = this.start(id).finally(() => this.starting.delete(id));
      this.starting.set(id, pending);
    }
    return pending;
  }

  private async start(id: string): Promise<Session> {
    if (!config.transcodeEnabled) throw new TranscodeError('ffmpeg', 'transcoding disabled');
    // Reap a dead session for this id before counting toward the cap.
    const stale = this.sessions.get(id);
    if (stale?.failed) await this.evict(id);
    if (this.sessions.size >= config.maxTranscodeSessions) throw new TranscodeError('busy');

    const dir = await mkdtemp(path.join(tmpdir(), `syncroom-hls-${id}-`));
    const abort = new AbortController();

    let upstream: globalThis.Response;
    try {
      // Full file, no Range: the encoder reads start-to-end from stdin.
      upstream = await fetchDrive(id, undefined, abort.signal);
    } catch {
      await rm(dir, { recursive: true, force: true });
      throw new TranscodeError('upstream');
    }
    const ct = upstream.headers.get('content-type') ?? '';
    if (!upstream.ok || ct.includes('text/html') || !upstream.body) {
      abort.abort();
      await rm(dir, { recursive: true, force: true });
      throw new TranscodeError('upstream');
    }

    const proc = spawn(config.ffmpegPath, ffmpegArgs(dir), {
      stdio: ['pipe', 'ignore', 'pipe'],
    });

    const session: Session = {
      id,
      dir,
      proc,
      abort,
      lastAccess: Date.now(),
      failed: false,
      stderr: '',
      ready: undefined as unknown as Promise<void>,
    };

    proc.stderr?.on('data', (chunk: Buffer) => {
      session.stderr = (session.stderr + chunk.toString()).slice(-2000);
    });
    // spawn failure (e.g. ffmpeg not installed) surfaces here, not as a throw.
    proc.on('error', () => {
      session.failed = true;
    });

    // Pipe Drive bytes into the encoder. EPIPE is expected when ffmpeg exits
    // early (bad input); swallow it so it doesn't crash the process.
    const body = Readable.fromWeb(upstream.body as unknown as NodeWebReadableStream<Uint8Array>);
    body.on('error', () => proc.kill('SIGKILL'));
    if (proc.stdin) {
      proc.stdin.on('error', () => {});
      body.pipe(proc.stdin);
    }
    proc.on('exit', () => {
      body.destroy();
    });

    session.ready = this.awaitPlaylist(session);
    // Don't leave an unhandled rejection if nobody is awaiting yet.
    session.ready.catch(() => {});
    this.sessions.set(id, session);
    return session;
  }

  private awaitPlaylist(session: Session): Promise<void> {
    const deadline = Date.now() + config.transcodeStartTimeoutMs;
    return new Promise<void>((resolve, reject) => {
      const tick = async (): Promise<void> => {
        if (await playlistHasSegment(session.dir)) return resolve();
        // ffmpeg gone (spawn error or non-zero exit) with no playlist = failure.
        if (session.failed || session.proc.exitCode !== null) {
          session.failed = true;
          return reject(new TranscodeError('ffmpeg', session.stderr.slice(-300)));
        }
        if (Date.now() > deadline) {
          session.failed = true;
          return reject(new TranscodeError('timeout'));
        }
        setTimeout(() => void tick(), 250);
      };
      void tick();
    });
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (s.failed || now - s.lastAccess > config.transcodeIdleMs) await this.evict(id);
    }
  }

  private async evict(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    session.abort.abort();
    session.proc.kill('SIGKILL');
    await rm(session.dir, { recursive: true, force: true }).catch(() => {});
  }

  /** Tear down every session (process shutdown). */
  async dispose(): Promise<void> {
    clearInterval(this.sweeper);
    await Promise.all([...this.sessions.keys()].map((id) => this.evict(id)));
  }

  /**
   * Streams a playlist or segment to an Express response. Keeps route handlers
   * thin and centralizes content-type / cache headers.
   */
  async serve(id: string, file: string, res: Response): Promise<void> {
    if (file === PLAYLIST) {
      const playlist = await this.getPlaylist(id);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-store');
      res.send(playlist);
      return;
    }
    const segPath = this.segmentPath(id, file);
    if (!segPath) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'no-store');
    const stream = createReadStream(segPath);
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).end();
      else res.destroy();
    });
    stream.pipe(res);
  }
}

export const transcodeManager = new TranscodeManager();
