import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  confirmUrlFrom,
  cookieHeaderFrom,
  fetchDrive,
  filenameFromDisposition,
  isUnplayableContainer,
  parseConfirmForm,
  videoMimeForFilename,
} from '../src/driveProxy';

/** Minimal stand-in for Google's "can't scan for viruses" interstitial. */
const INTERSTITIAL = `<!doctype html><html><body>
  <form id="download-form" action="https://drive.usercontent.google.com/download" method="get">
    <input type="hidden" name="id" value="FILEID12345">
    <input type="hidden" name="export" value="download">
    <input type="hidden" name="authuser" value="0">
    <input type="hidden" name="confirm" value="abc123token">
    <input type="hidden" name="uuid" value="uuid-xyz-789">
  </form>
</body></html>`;

function htmlResponse(html: string, setCookies: string[] = []): Response {
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
  for (const c of setCookies) headers.append('set-cookie', c);
  return new Response(html, { status: 200, headers });
}

function videoResponse(): Response {
  return new Response('BINARY', {
    status: 206,
    headers: { 'content-type': 'video/mp4', 'accept-ranges': 'bytes' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('parseConfirmForm / confirmUrlFrom', () => {
  it('extracts the confirm token + uuid from the interstitial form', () => {
    const params = parseConfirmForm(INTERSTITIAL);
    expect(params).toMatchObject({ id: 'FILEID12345', confirm: 'abc123token', uuid: 'uuid-xyz-789' });

    const url = new URL(confirmUrlFrom(INTERSTITIAL, 'FILEID12345')!);
    expect(url.searchParams.get('confirm')).toBe('abc123token');
    expect(url.searchParams.get('uuid')).toBe('uuid-xyz-789');
    expect(url.searchParams.get('export')).toBe('download');
  });

  it('falls back to scraping a confirm= link when the form markup is gone', () => {
    const scraped = `<a href="/download?id=X&amp;export=download&amp;confirm=zzz9&amp;uuid=u-1">Download anyway</a>`;
    const url = new URL(confirmUrlFrom(scraped, 'FILEID12345')!);
    expect(url.searchParams.get('confirm')).toBe('zzz9');
    expect(url.searchParams.get('uuid')).toBe('u-1');
    expect(url.searchParams.get('id')).toBe('FILEID12345');
  });

  it('returns null when nothing confirm-like is present', () => {
    expect(confirmUrlFrom('<html><body>Sign in</body></html>', 'X')).toBeNull();
  });
});

describe('cookieHeaderFrom', () => {
  it('collapses Set-Cookie headers into name=value pairs', () => {
    const res = htmlResponse('x', [
      'download_warning_abc=yes; Path=/; HttpOnly',
      'NID=511=token; Domain=.google.com; HttpOnly',
    ]);
    expect(cookieHeaderFrom(res)).toBe('download_warning_abc=yes; NID=511=token');
  });

  it('returns null when there are no cookies', () => {
    expect(cookieHeaderFrom(new Response('x'))).toBeNull();
  });
});

describe('filenameFromDisposition', () => {
  it('parses the quoted filename form', () => {
    const res = new Response('x', {
      headers: { 'content-disposition': 'attachment; filename="movie night.mp4"' },
    });
    expect(filenameFromDisposition(res)).toBe('movie night.mp4');
  });

  it("prefers the RFC 5987 filename* form and decodes its percent-encoding", () => {
    const res = new Response('x', {
      headers: {
        'content-disposition':
          `attachment; filename="fallback.mp4"; filename*=UTF-8''caf%C3%A9%20night.mp4`,
      },
    });
    expect(filenameFromDisposition(res)).toBe('café night.mp4');
  });

  it('returns null when the header is absent', () => {
    expect(filenameFromDisposition(new Response('x'))).toBeNull();
  });
});

describe('videoMimeForFilename / isUnplayableContainer', () => {
  it('maps browser-playable extensions to MIME types', () => {
    expect(videoMimeForFilename('movie.mp4')).toBe('video/mp4');
    expect(videoMimeForFilename('clip.webm')).toBe('video/webm');
  });

  it('returns null for un-playable and unknown extensions', () => {
    expect(videoMimeForFilename('old.mpg')).toBeNull();
    expect(videoMimeForFilename('mystery.xyz')).toBeNull();
    expect(videoMimeForFilename('noextension')).toBeNull();
    expect(videoMimeForFilename(null)).toBeNull();
  });

  it('flags known-unplayable containers, but not playable ones or null', () => {
    expect(isUnplayableContainer('old.mpg')).toBe(true);
    expect(isUnplayableContainer('rip.mkv')).toBe(true);
    expect(isUnplayableContainer('movie.mp4')).toBe(false);
    expect(isUnplayableContainer(null)).toBe(false);
  });
});

describe('fetchDrive large-file confirm flow', () => {
  it('echoes the interstitial cookie on the confirm request (regression: large movies)', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      // First hit: the interstitial, which sets a download-warning cookie.
      if (calls.length === 1) {
        return htmlResponse(INTERSTITIAL, ['download_warning_abc=yes; Path=/; HttpOnly']);
      }
      // Confirm hit: the real bytes.
      return videoResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchDrive('FILEID12345', 'bytes=0-', new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The confirm request carried the token AND the cookie Google demanded.
    expect(calls[1]!.url).toContain('confirm=abc123token');
    expect(calls[1]!.headers.cookie).toBe('download_warning_abc=yes');
    // The Range from the browser is preserved across the confirm hop.
    expect(calls[1]!.headers.range).toBe('bytes=0-');
    expect(res.headers.get('content-type')).toBe('video/mp4');
  });

  it('streams directly when the first response is already the file', async () => {
    const fetchMock = vi.fn(async () => videoResponse());
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchDrive('FILEID12345', undefined, new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(206);
  });
});
