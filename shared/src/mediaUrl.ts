import type { MediaKind } from './types';

export interface ParsedMedia {
  kind: MediaKind;
  url: string;
  providerId?: string;
  title: string;
}

/** Why a pasted link was rejected — surfaced to the user verbatim-ish. */
export type MediaUrlErrorReason =
  'invalid-url' | 'unsupported-protocol' | 'youtube-no-video' | 'drive-not-a-file';

export type MediaUrlResult =
  { ok: true; media: ParsedMedia } | { ok: false; reason: MediaUrlErrorReason };

export const MEDIA_URL_ERROR_TEXT: Record<MediaUrlErrorReason, string> = {
  'invalid-url': 'That does not look like a link. Paste a full URL starting with https://',
  'unsupported-protocol': 'Only http(s) links can be played.',
  'youtube-no-video':
    'That YouTube link has no video in it (playlists and channel pages are not supported — open the video and copy its URL).',
  'drive-not-a-file':
    'That Google Drive link is not a single file (folders are not supported — right-click the video file and copy its share link).',
};

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeId(url: URL): string | null {
  if (!YOUTUBE_HOSTS.has(url.hostname)) return null;
  if (url.hostname.endsWith('youtu.be')) {
    const id = url.pathname.slice(1).split('/')[0] ?? '';
    return YOUTUBE_ID.test(id) ? id : null;
  }
  const v = url.searchParams.get('v');
  if (v && YOUTUBE_ID.test(v)) return v;
  const parts = url.pathname.split('/').filter(Boolean);
  // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
  if (parts.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')) {
    const id = parts[1] ?? '';
    return YOUTUBE_ID.test(id) ? id : null;
  }
  return null;
}

/** Hosts that can carry a Google Drive file reference. */
const DRIVE_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
  'drive.usercontent.google.com',
]);

const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;

export function isDriveHost(url: URL): boolean {
  return DRIVE_HOSTS.has(url.hostname);
}

/**
 * Extracts a file id from every common Drive share shape:
 *   drive.google.com/file/d/<id>/view|preview|edit
 *   drive.google.com/open?id=<id>
 *   drive.google.com/uc?id=<id>[&export=download|view]
 *   docs.google.com/uc?id=<id>
 *   drive.usercontent.google.com/download?id=<id>
 */
export function parseDriveId(url: URL): string | null {
  if (!isDriveHost(url)) return null;
  const m = url.pathname.match(/\/file\/d\/([^/]+)/);
  if (m?.[1] && DRIVE_ID.test(m[1])) return m[1];
  const id = url.searchParams.get('id');
  if (id && DRIVE_ID.test(id)) return id;
  return null;
}

/** Direct-download URL for a Drive file; works for files without the virus-scan interstitial. */
export function driveDirectUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

/** Iframe preview URL — always renders, but exposes no playback API (no sync). */
export function driveEmbedUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

const FILE_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v)(?:$|[?#])/i;
const HLS_EXT = /\.m3u8(?:$|[?#])/i;
const DASH_EXT = /\.mpd(?:$|[?#])/i;

function fileNameFromPath(pathname: string): string {
  const last = pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * Classifies a pasted URL into a playable media item, or a specific,
 * user-explainable rejection. Provider detection is automatic; the caller
 * never needs to know URL shapes.
 */
export function classifyMediaUrl(raw: string): MediaUrlResult {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported-protocol' };
  }

  if (YOUTUBE_HOSTS.has(url.hostname)) {
    const ytId = parseYouTubeId(url);
    if (!ytId) return { ok: false, reason: 'youtube-no-video' };
    return {
      ok: true,
      media: { kind: 'youtube', url: url.toString(), providerId: ytId, title: `YouTube · ${ytId}` },
    };
  }

  if (isDriveHost(url)) {
    const driveId = parseDriveId(url);
    if (!driveId) return { ok: false, reason: 'drive-not-a-file' };
    return {
      ok: true,
      media: {
        kind: 'drive',
        url: driveDirectUrl(driveId),
        providerId: driveId,
        title: 'Google Drive video',
      },
    };
  }

  if (HLS_EXT.test(url.pathname)) {
    return {
      ok: true,
      media: { kind: 'hls', url: url.toString(), title: fileNameFromPath(url.pathname) },
    };
  }
  if (DASH_EXT.test(url.pathname)) {
    return {
      ok: true,
      media: { kind: 'dash', url: url.toString(), title: fileNameFromPath(url.pathname) },
    };
  }
  if (FILE_EXT.test(url.pathname)) {
    return {
      ok: true,
      media: { kind: 'file', url: url.toString(), title: fileNameFromPath(url.pathname) },
    };
  }

  // Unknown extension — let the HTML5 player attempt it (servers often omit extensions).
  return {
    ok: true,
    media: {
      kind: 'file',
      url: url.toString(),
      title: fileNameFromPath(url.pathname) || url.hostname,
    },
  };
}

/** Back-compat convenience: media on success, null on any rejection. */
export function parseMediaUrl(raw: string): ParsedMedia | null {
  const result = classifyMediaUrl(raw);
  return result.ok ? result.media : null;
}
